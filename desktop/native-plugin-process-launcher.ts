/* SPDX-License-Identifier: AGPL-3.0-only */

/** Windows trusted plug-in processes: authenticated host, Job limits, ambient user access. */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import { bindNativeChildProcess } from './native-child-framed-control.ts';
import { nativeChildEnforcementFailure, waitForNativeChildEnforcement } from './native-child-enforcement-handshake.ts';
import { canonicalNativeChildFileIdentity, nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import type {
	NativeChildIsolationArtifactDescriptor, NativeChildIsolationLaunch,
	NativeChildIsolationLaunchRequest, NativeChildIsolationSpawn,
} from './native-child-isolation-contract.ts';

export interface SupervisedNativePluginEnforcement {
	readonly kind: 'native-plugin-process-supervised';
	readonly target: 'win-x64' | 'win-arm64';
	readonly pid: number;
	readonly filesystem: 'user';
	readonly network: 'user';
	readonly childProcesses: 'denied';
	readonly allocationRandomization: 'system' | 'low-entropy-for-legacy-vst2';
}

export type NativePluginProcessLaunch = Omit<NativeChildIsolationLaunch, 'enforcement'> & {
	readonly enforcement: SupervisedNativePluginEnforcement;
};

const supervised = new WeakSet<object>();
export function isSupervisedNativePluginLaunch(value: unknown): value is SupervisedNativePluginEnforcement {
	return value !== null && typeof value === 'object' && supervised.has(value);
}

export function createNativePluginProcessLauncher(options: Readonly<{
	target: string;
	peerExecutable: NativeChildIsolationArtifactDescriptor;
	artifacts: Readonly<{
		launcher: NativeChildIsolationArtifactDescriptor;
		sandboxProfile: NativeChildIsolationArtifactDescriptor;
		brokerPolicy: NativeChildIsolationArtifactDescriptor;
	}>;
	spawn?: NativeChildIsolationSpawn;
	runtimeTarget?: () => string;
}>) {
	const { target, peerExecutable: peer, artifacts } = options;
	const spawn = options.spawn ?? nodeSpawn;
	const runtimeTarget = options.runtimeTarget ?? (() => process.platform === 'win32' ? `win-${process.arch}` : 'unsupported');
	const verify = async () => {
		if (runtimeTarget() !== target
			|| !['win-x64', 'win-arm64'].includes(target)) {
			throw new Error('Trusted Windows plug-in processes require a matching Windows machine.');
		}
		const handles: FileHandle[] = [];
		try {
			for (const artifact of [artifacts.launcher, artifacts.sandboxProfile, artifacts.brokerPolicy, peer]) {
				handles.push(await authenticatedFile(artifact));
			}
			const profile = JSON.parse(await readFile(artifacts.sandboxProfile.path, 'utf8')) as { trustedPluginProcesses?: unknown };
			if (profile.trustedPluginProcesses !== 'user-access-job-v2') {
				throw new Error('This Windows launcher payload does not support trusted plug-in processes.');
			}
		} finally { await closeFiles(handles); }
	};
	return Object.freeze({
		pluginFilesystemAccess: 'user' as const,
		...(target === 'win-x64' ? { vst2LowAddressHeap: true as const } : {}),
		machineReady: async () => {
			try { await verify(); return Object.freeze({ status: 'ready' as const, target }); }
			catch (error) { return Object.freeze({ status: 'unavailable' as const, target,
				detail: error instanceof Error ? error.message : String(error) }); }
		},
		launch: async (request: NativeChildIsolationLaunchRequest): Promise<NativePluginProcessLaunch> => {
			await verify();
			const legacyHeap = request.windowsVst2LowAddressHeap === true;
			if (request.windowsVst2LowAddressHeap !== undefined && (!legacyHeap || target !== 'win-x64')) {
				throw new Error('Legacy VST2 allocation compatibility requires a trusted Windows x64 process.');
			}
			if (request.executable.path !== peer.path || request.executable.sha256 !== peer.sha256
				|| request.arguments.length !== 0 || request.runtimeClosure?.length
				|| request.extraInput || !request.framedControl
				|| request.workloadPayload?.sha256 !== peer.sha256) {
				throw new Error('A trusted plug-in process requires its exact authenticated peer and framed transport.');
			}
			const { maximumJobDurationMs: duration, maximumRssBytes: rss } = request.resourcePolicy;
			if (!Number.isSafeInteger(duration) || duration < 1 || duration > 86_400_000
				|| !Number.isSafeInteger(rss) || rss < 1 || rss > 1024 ** 3) {
				throw new Error('Invalid trusted plug-in process resource limits.');
			}
			const handles: FileHandle[] = [];
			let child: ChildProcess | null = null;
			try {
				for (const artifact of [artifacts.launcher, artifacts.sandboxProfile, artifacts.brokerPolicy, peer]) {
					handles.push(await authenticatedFile(artifact));
				}
				child = spawn(artifacts.launcher.path, [
					'--plugin-user-access', ...(legacyHeap ? ['--plugin-low-address-heap'] : []),
					'--enforcement-fd=3', '--profile-fd=5', '--broker-policy-fd=6',
					'--executable-fd=7', `--authority-profile=soundscaper-professional:${peer.sha256}`,
					`--maximum-duration-ms=${duration}`, `--maximum-rss-bytes=${rss}`, '--', 'native-plugin-child',
				], { shell: false, windowsHide: true, env: { ...process.env, NODE_V8_COVERAGE: undefined },
					stdio: ['pipe', 'pipe', 'pipe', 'pipe', ...handles.map(({ fd }) => fd)] });
				const binding = bindNativeChildProcess(child, request.framedControl);
				const timer = setTimeout(() => { child?.kill('SIGKILL'); }, duration);
				const completion = binding.completion.finally(() => { clearTimeout(timer); });
				void completion.catch(() => undefined);
				try {
					const stream = child.stdio[3] as Readable | null;
					if (!stream) throw new Error('The plug-in Job launcher has no supervision pipe.');
					await waitForNativeChildEnforcement(stream, 5_000, 'M5_NATIVE_PLUGIN_PROCESS_SUPERVISED_V1\n');
				} catch (error) {
					child.kill('SIGKILL');
					throw nativeChildEnforcementFailure(error, await completion.catch(() => null));
				}
				if (!child.pid) throw new Error('The supervised plug-in process has no process identity.');
				const enforcement = Object.freeze({ kind: 'native-plugin-process-supervised' as const,
					target: target as 'win-x64' | 'win-arm64', pid: child.pid,
					allocationRandomization: legacyHeap ? 'low-entropy-for-legacy-vst2' as const : 'system' as const,
					filesystem: 'user' as const, network: 'user' as const, childProcesses: 'denied' as const });
				supervised.add(enforcement);
				const launchedChild = child;
				return Object.freeze({ enforcement, stdin: child.stdin, extraInput: null,
					control: binding.control, completion, kill: (signal?: NodeJS.Signals) => launchedChild.kill(signal) });
			} catch (error) { child?.kill('SIGKILL'); throw error; }
			finally { await closeFiles(handles); }
		},
	});
}

async function authenticatedFile(artifact: NativeChildIsolationArtifactDescriptor): Promise<FileHandle> {
	const handle = await open(artifact.path, 'r');
	try {
		const metadata = await handle.stat({ bigint: true });
		const identity = nativeChildFileIdentityFromStat(metadata);
		const expected = canonicalNativeChildFileIdentity(artifact.identity);
		const bytes = await handle.readFile();
		if (!metadata.isFile() || identity.dev !== expected.dev || identity.ino !== expected.ino
			|| bytes.byteLength !== artifact.byteLength || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
			throw new Error('The authenticated plug-in process artifact changed.');
		}
		return handle;
	} catch (error) { await handle.close(); throw error; }
}

async function closeFiles(handles: readonly FileHandle[]): Promise<void> {
	const results = await Promise.allSettled(handles.map((handle) => handle.close()));
	const failures = results.filter((result) => result.status === 'rejected');
	if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Plug-in artifact handles could not close.');
}
