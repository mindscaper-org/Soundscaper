/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { bindNativeChildProcess } from './native-child-framed-control.ts';
import { nativeChildEnforcementFailure, waitForNativeChildEnforcement } from './native-child-enforcement-handshake.ts';
import { canonicalNativeChildFileIdentity, nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import type { NativeChildIsolationArtifactDescriptor, NativeChildIsolationLaunch, NativeChildIsolationLaunchRequest } from './native-child-isolation-contract.ts';
import type { ExternalWineInstallation } from './external-wine.ts';
import { resolveWineServer, resolveWineSharedServices } from './wine-server.ts';

interface WinePluginSupervision {
	readonly kind: 'wine-plugin-process-supervised'; readonly target: 'linux-x64'; readonly pid: number;
	readonly filesystem: 'user'; readonly network: 'user'; readonly childProcesses: 'supervised-tree';
}
export type WinePluginProcessLaunch = Omit<NativeChildIsolationLaunch, 'enforcement'> & { readonly enforcement: WinePluginSupervision };
const supervised = new WeakSet<object>();
export function isWinePluginSupervised(value: unknown): value is WinePluginSupervision {
	return value !== null && typeof value === 'object' && supervised.has(value);
}

export function createWinePluginLauncher(options: Readonly<{
	peerExecutable: NativeChildIsolationArtifactDescriptor;
	entryExecutable: NativeChildIsolationArtifactDescriptor;
	entryArguments: readonly string[];
	artifacts: readonly NativeChildIsolationArtifactDescriptor[];
	wine: Readonly<ExternalWineInstallation>;
	resolveServer?: typeof resolveWineServer;
	resolveSharedServices?: typeof resolveWineSharedServices;
}>) {
	const launcher = options.artifacts.find(({ path }) => path.endsWith('/soundscaper-wine-launcher'));
	if (!launcher || options.wine.state !== 'ready' || !options.wine.location || !options.wine.sha256) {
		throw new Error('The bundled Wine launcher or detected Wine installation is unavailable.');
	}
	return Object.freeze({
		pluginFilesystemAccess: 'user' as const,
		launch: async (request: NativeChildIsolationLaunchRequest): Promise<WinePluginProcessLaunch> => {
			if (process.platform !== 'linux' || process.arch !== 'x64'
				|| request.executable.path !== options.entryExecutable.path
				|| request.executable.sha256 !== options.entryExecutable.sha256
				|| request.workloadPayload?.sha256 !== options.peerExecutable.sha256
				|| JSON.stringify(request.arguments) !== JSON.stringify(options.entryExecutable.path === options.peerExecutable.path
					? [] : [...options.entryArguments, options.peerExecutable.path])
				|| !request.framedControl || request.extraInput || request.windowsVst2LowAddressHeap) {
				throw new Error('A Wine plugin launch requires its exact authenticated Linux x64 peer and transport.');
			}
			const { maximumJobDurationMs: duration, maximumRssBytes: memory } = request.resourcePolicy;
			if (!Number.isSafeInteger(duration) || duration < 1 || duration > 86_400_000
				|| !Number.isSafeInteger(memory) || memory < 1 || memory > 1024 ** 3) throw new Error('Invalid Wine host resource bounds.');
			const handles: FileHandle[] = [];
			try {
				const server = await (options.resolveServer ?? resolveWineServer)(options.wine);
				const services = await (options.resolveSharedServices ?? resolveWineSharedServices)(options.wine);
				for (const artifact of [...options.artifacts, options.peerExecutable, options.entryExecutable, ...(request.runtimeClosure ?? [])]) {
					handles.push(await authenticate(artifact));
				}
				const wine = await open(options.wine.location!, constants.O_RDONLY | constants.O_NOFOLLOW);
				handles.push(wine);
				const wineMetadata = await wine.stat();
				if (!wineMetadata.isFile() || wineMetadata.size > 256 * 1024 ** 2
					|| createHash('sha256').update(await wine.readFile()).digest('hex') !== options.wine.sha256) {
					throw new Error('The detected Wine executable changed; rescan Wine in Effects preferences.');
				}
				const entry = handles[options.artifacts.length + 1]!;
				const serverHandle = await authenticate(server); handles.push(serverHandle);
				const serviceHandles: FileHandle[] = [];
				for (const artifact of services) { const handle = await authenticate(artifact); handles.push(handle); serviceHandles.push(handle); }
				const environment = wineEnvironment(options.wine.location!, dirname(launcher.path), server.path);
				const child = spawn(launcher.path, [String(duration), String(memory), '--',
					options.entryExecutable.path, ...request.arguments], { shell: false, env: environment,
					stdio: ['pipe', 'pipe', 'pipe', 'pipe', entry.fd, serverHandle.fd, ...serviceHandles.map(({ fd }) => fd)] });
				const binding = bindNativeChildProcess(child, request.framedControl);
				/* Shared Wine services may retain inherited descriptors after the peer
				 * exits. They must not hold its framed transport or completion open. */
				child.once('exit', () => { child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); });
				void binding.completion.catch(() => undefined);
				try {
					await waitForNativeChildEnforcement(child.stdio[3] as Readable, 5_000, 'M5_WINE_PLUGIN_PROCESS_SUPERVISED_V1\n');
					if (!child.pid) throw new Error('The Wine host has no process identity.');
				} catch (error) { child.kill('SIGKILL'); throw nativeChildEnforcementFailure(error, await binding.completion.catch(() => null)); }
				const enforcement: WinePluginSupervision = Object.freeze({ kind: 'wine-plugin-process-supervised',
					target: 'linux-x64', pid: child.pid, filesystem: 'user', network: 'user', childProcesses: 'supervised-tree' });
				supervised.add(enforcement);
				return Object.freeze({ enforcement, stdin: child.stdin, extraInput: null, control: binding.control,
					completion: binding.completion, kill: (signal?: NodeJS.Signals) => child.kill(signal) });
			} finally { await Promise.all(handles.map((handle) => handle.close())); }
		},
	});
}

async function authenticate(artifact: NativeChildIsolationArtifactDescriptor): Promise<FileHandle> {
	const handle = await open(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const metadata = await handle.stat({ bigint: true });
		const identity = canonicalNativeChildFileIdentity(nativeChildFileIdentityFromStat(metadata));
		const expected = canonicalNativeChildFileIdentity(artifact.identity);
		if (!metadata.isFile() || metadata.size !== BigInt(artifact.byteLength) || artifact.byteLength > 128 * 1024 ** 2
			|| identity.dev !== expected.dev || identity.ino !== expected.ino
			|| createHash('sha256').update(await handle.readFile()).digest('hex') !== artifact.sha256) {
			throw new Error('An authenticated Wine host artifact changed.');
		}
		return handle;
	} catch (error) { await handle.close(); throw error; }
}

function wineEnvironment(wine: string, bridge: string, server: string): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const key of ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY',
		'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'WINEPREFIX', 'WINEDLLOVERRIDES', 'WINEESYNC', 'WINEFSYNC']) {
		if (typeof process.env[key] === 'string') environment[key] = process.env[key];
	}
	environment.PATH = [bridge, dirname(wine), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
	environment.WINELOADER = wine;
	environment.WINESERVER = server;
	return environment;
}
