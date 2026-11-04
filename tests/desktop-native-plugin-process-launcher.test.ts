/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createNativePluginProcessLauncher, isSupervisedNativePluginLaunch } from '../desktop/native-plugin-process-launcher.ts';
import { prepareProfessionalPluginCandidate } from '../desktop/professional-plugin-custody.ts';
import { waitForNativeChildEnforcement } from '../desktop/native-child-enforcement-handshake.ts';
import { createProfessionalNativeHelperRoleSeams } from '../desktop/native-helper-process.js';
import type { NativeChildIsolationLaunchRequest, NativeChildIsolationSpawn } from '../desktop/native-child-isolation-contract.ts';

test('trusted plugin custody preserves its installed location and authenticates the selected bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'installed-plugin-custody-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = await realpath(root).then((directory) => join(directory, 'effect.vst3'));
	await writeFile(path, 'installed effect');
	const expected = await descriptor(path);
	const candidate = await prepareProfessionalPluginCandidate(path, expected, true);
	assert.equal(candidate.path, path, 'relative vendor runtimes must resolve beside the installed plugin');
	await candidate.dispose();
	assert.equal(await readFile(path, 'utf8'), 'installed effect');
	await writeFile(path, 'changed effect');
	await assert.rejects(prepareProfessionalPluginCandidate(path, expected, true), /changed/u);
});

test('sandboxed plugin custody still uses and removes an immutable snapshot', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'sandboxed-plugin-custody-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(await realpath(root), 'effect.clap');
	await writeFile(path, 'sandboxed effect');
	const candidate = await prepareProfessionalPluginCandidate(path, await descriptor(path), false);
	assert.notEqual(candidate.path, path);
	assert.equal(await readFile(candidate.path, 'utf8'), 'sandboxed effect');
	await candidate.dispose();
	await assert.rejects(stat(candidate.path), { code: 'ENOENT' });
});

test('a plain object cannot claim supervised plugin process enforcement', () => {
	assert.equal(isSupervisedNativePluginLaunch({ kind: 'native-plugin-process-supervised' }), false);
});

test('trusted process supervision cannot be mistaken for an OS sandbox handshake', async () => {
	const trustedFrame = 'M5_NATIVE_PLUGIN_PROCESS_SUPERVISED_V1\n';
	const sandbox = new PassThrough();
	const refusal = assert.rejects(waitForNativeChildEnforcement(sandbox, 1_000), /malformed|ended early/u);
	sandbox.end(trustedFrame);
	await refusal;
	const trusted = new PassThrough();
	const accepted = waitForNativeChildEnforcement(trusted, 1_000, trustedFrame);
	trusted.end(trustedFrame);
	await accepted;
});

test('Windows production effects select user access while analyzers retain their sandbox', async () => {
	const artifact = { path: '/peer', byteLength: 1, sha256: 'a'.repeat(64), identity: { dev: 1, ino: 1 } };
	const sandbox = { machineReady: async () => ({ status: 'ready' }) };
	const trusted = { pluginFilesystemAccess: 'user' };
	const effectLaunchers: unknown[] = [];
	const analyzerLaunchers: unknown[] = [];
	const ports = {
		verifyPayload: async () => ({ target: 'win-x64', pluginPeer: artifact, isolation: {
			entrypoint: artifact, runtimeClosure: [], launcher: artifact, sandboxProfile: artifact, brokerPolicy: artifact,
		} }),
		createLauncher: () => sandbox,
		createPluginLauncher: () => trusted,
		createPeer: (options: { launcher: unknown }) => { effectLaunchers.push(options.launcher); return {}; },
		createVampPeer: (options: { launcher: unknown }) => { analyzerLaunchers.push(options.launcher); return {}; },
	};
	await createProfessionalNativeHelperRoleSeams({}, 'plugin-host', ports);
	await createProfessionalNativeHelperRoleSeams({}, 'plugin-analyzer', ports);
	assert.deepEqual(effectLaunchers, [trusted]);
	assert.deepEqual(analyzerLaunchers, [sandbox]);
});

test('Windows plugin process launch refuses unsupported machines before spawning', async () => {
	if (process.platform === 'win32') return;
	const artifact = { path: '/unavailable', byteLength: 1, sha256: 'a'.repeat(64), identity: { dev: 1, ino: 1 } };
	const launcher = createNativePluginProcessLauncher({
		target: 'win-x64', peerExecutable: artifact,
		artifacts: { launcher: artifact, sandboxProfile: artifact, brokerPolicy: artifact },
	});
	assert.equal((await launcher.machineReady()).status, 'unavailable');
});

test('trusted process launch authenticates artifacts, preserves user environment and supervises framed replies', async (context) => {
	const fixture = await processFixture(context);
	const launch = await fixture.launcher.launch(fixture.request);
	assert.equal(isSupervisedNativePluginLaunch(launch.enforcement), true);
	assert.equal(launch.enforcement.filesystem, 'user');
	assert.equal(launch.enforcement.network, 'user');
	assert.equal(launch.enforcement.childProcesses, 'denied');
	assert.equal(launch.enforcement.allocationRandomization, 'system');
	assert.equal(fixture.calls[0]?.options.shell, false);
	assert.equal(fixture.calls[0]?.options.env?.PATH, process.env.PATH);
	assert.equal(fixture.calls[0]?.arguments.includes('--plugin-user-access'), true);
	assert.equal(fixture.calls[0]?.arguments.includes('--plugin-low-address-heap'), false);
	assert.ok(launch.control);
	await launch.control.send(new Uint8Array([2, 7]));
	const body = Buffer.from([2, 7, 0, 0, 0, 0]);
	const header = Buffer.alloc(8); header.write('M5F2'); header.writeUInt32LE(body.length, 4);
	fixture.output.write(Buffer.concat([header, body]));
	assert.deepEqual(await launch.control.receive(), new Uint8Array(body));
	fixture.finish();
	assert.equal((await launch.completion).exitCode, 0);
});

test('trusted processes reject stale payloads and sandbox-only payload profiles before spawn', async (context) => {
	const fixture = await processFixture(context);
	await writeFile(fixture.peer.path, 'replacement peer');
	await assert.rejects(fixture.launcher.launch(fixture.request), /artifact changed/u);
	assert.equal(fixture.calls.length, 0);
	const sandboxOnly = await processFixture(context, { trustedProfile: false });
	assert.equal((await sandboxOnly.launcher.machineReady()).status, 'unavailable');
	assert.equal(sandboxOnly.calls.length, 0);
});

test('trusted processes reject requests for another executable or invalid resource limits', async (context) => {
	const fixture = await processFixture(context);
	await assert.rejects(fixture.launcher.launch({ ...fixture.request,
		executable: { ...fixture.peer, sha256: 'b'.repeat(64) } }), /exact authenticated peer/u);
	await assert.rejects(fixture.launcher.launch({ ...fixture.request,
		resourcePolicy: { maximumJobDurationMs: 0, maximumRssBytes: 1 } }), /resource limits/u);
	assert.equal(fixture.calls.length, 0);
});

test('a sandbox handshake cannot publish a trusted process and its launcher is killed', async (context) => {
	const fixture = await processFixture(context, { handshake: 'M5_NATIVE_ISOLATION_ENFORCED_V1\n' });
	await assert.rejects(fixture.launcher.launch(fixture.request), /handshake/u);
	assert.ok(fixture.kills.length);
});

test('the trusted process wall deadline kills its Job launcher', async (context) => {
	const fixture = await processFixture(context);
	const launch = await fixture.launcher.launch({ ...fixture.request,
		resourcePolicy: { maximumJobDurationMs: 100, maximumRssBytes: 1024 ** 2 } });
	assert.equal((await launch.completion).signal, 'SIGKILL');
	assert.ok(fixture.kills.includes('SIGKILL'));
});

test('legacy VST2 allocation compatibility changes only its explicitly selected child', async (context) => {
	const fixture = await processFixture(context);
	assert.equal(fixture.launcher.vst2LowAddressHeap, true);
	const launch = await fixture.launcher.launch({ ...fixture.request, windowsVst2LowAddressHeap: true });
	assert.equal(fixture.calls[0]?.arguments.includes('--plugin-low-address-heap'), true);
	assert.equal(launch.enforcement.allocationRandomization, 'low-entropy-for-legacy-vst2');
	fixture.finish();
	await launch.completion;
});

async function processFixture(context: { after: (action: () => Promise<void>) => void }, options: {
	trustedProfile?: boolean; handshake?: string;
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'trusted-plugin-process-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifacts = [];
	for (const [name, bytes] of Object.entries({ launcher: 'launcher', profile: JSON.stringify({
		trustedPluginProcesses: options.trustedProfile === false ? undefined : 'user-access-job-v2',
	}), broker: 'broker', peer: 'peer' })) {
		const path = join(root, name); await writeFile(path, bytes); artifacts.push(await descriptor(path));
	}
	const [launcherArtifact, profile, broker, peer] = artifacts;
	assert.ok(launcherArtifact && profile && broker && peer);
	const input = new PassThrough(), output = new PassThrough(), error = new PassThrough(), handshake = new PassThrough();
	const calls: Array<{ arguments: readonly string[]; options: Parameters<NativeChildIsolationSpawn>[2] }> = [];
	const kills: Array<NodeJS.Signals | undefined> = [];
	let finished = false;
	const finish = (signal: NodeJS.Signals | null = null) => {
		if (finished) return;
		finished = true; output.end(); error.end(); child.emit('close', signal ? null : 0, signal);
	};
	const child = Object.assign(new EventEmitter(), {
		pid: 123, stdin: input, stdout: output, stderr: error, stdio: [input, output, error, handshake],
		kill: (signal?: NodeJS.Signals) => { kills.push(signal); queueMicrotask(() => { finish(signal ?? 'SIGTERM'); }); return true; },
	}) as unknown as ChildProcess;
	const launcher = createNativePluginProcessLauncher({
		target: 'win-x64', peerExecutable: peer, runtimeTarget: () => 'win-x64',
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
		spawn: (_command, arguments_, spawnOptions) => {
			calls.push({ arguments: arguments_, options: spawnOptions });
			queueMicrotask(() => { handshake.end(options.handshake ?? 'M5_NATIVE_PLUGIN_PROCESS_SUPERVISED_V1\n'); });
			return child;
		},
	});
	const request: NativeChildIsolationLaunchRequest = { executable: peer, workloadPayload: peer,
		arguments: [], readOnly: [], readExecute: [], writeOnly: [], runtimeClosure: [],
		resourcePolicy: { maximumJobDurationMs: 1_000, maximumRssBytes: 1024 ** 2 },
		framedControl: { protocolFamily: 'M5F', protocolVersion: 2, maximumMessageBytes: 1024, maximumInFlightMessages: 1 } };
	return { launcher, request, peer, output, calls, kills, finish };
}

async function descriptor(path: string) {
	const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
	return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: { dev: metadata.dev, ino: metadata.ino } };
}
