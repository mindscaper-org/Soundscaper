/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	readAuthenticatedWindowsPluginArchitecture, windowsPluginArchitecture,
} from '../desktop/windows-plugin-architecture.ts';
import { createWindowsVst2BridgeRouter } from '../desktop/windows-vst2-bridge-router.ts';

function pe(machine: number, magic: number): Buffer {
	const bytes = Buffer.alloc(512);
	bytes.write('MZ'); bytes.writeUInt32LE(128, 0x3c); bytes.write('PE\0\0', 128, 'binary');
	bytes.writeUInt16LE(machine, 132); bytes.writeUInt16LE(magic, 152);
	return bytes;
}

test('Windows plugin architecture requires a matching PE machine and optional-header ABI', () => {
	assert.equal(windowsPluginArchitecture(pe(0x14c, 0x10b)), 'ia32');
	assert.equal(windowsPluginArchitecture(pe(0x8664, 0x20b)), 'x64');
	assert.equal(windowsPluginArchitecture(pe(0xaa64, 0x20b)), 'arm64');
	for (const bytes of [pe(0x14c, 0x20b), pe(0x8664, 0x10b), Buffer.from('bad'), pe(0, 0)]) {
		assert.throws(() => windowsPluginArchitecture(bytes), /PE|architecture/u);
	}
	const oversizedOffset = pe(0x14c, 0x10b); oversizedOffset.writeUInt32LE(0xfffffff0, 0x3c);
	assert.throws(() => windowsPluginArchitecture(oversizedOffset), /PE/u);
});

test('architecture selection authenticates the exact granted plugin, including large file identities', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'vst2-bridge-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'legacy.dll'); const bytes = pe(0x14c, 0x10b);
	await writeFile(path, bytes);
	const metadata = await stat(path, { bigint: true });
	const expected = { identity: { dev: metadata.dev.toString(), ino: metadata.ino.toString() },
		byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
	assert.equal(await readAuthenticatedWindowsPluginArchitecture(path, expected), 'ia32');
	await assert.rejects(readAuthenticatedWindowsPluginArchitecture(path, { ...expected, sha256: '0'.repeat(64) }), /changed|authentication/u);
	await writeFile(path, pe(0x8664, 0x20b));
	await assert.rejects(readAuthenticatedWindowsPluginArchitecture(path, expected), /changed|authentication/u);
});

test('only opted-in Windows x64 VST2 requests select the x86 peer for scans and hosts', async () => {
	const calls: string[] = [];
	const native = {
		inspectPluginCandidate: async () => { calls.push('native-scan'); return [{ status: 'ok', stableId: 'vst2:1' }]; },
		openPluginInstance: async () => { calls.push('native-open'); return { native: true }; },
	};
	const bridge = {
		inspectPluginCandidate: async () => { calls.push('x86-scan'); return [{ status: 'ok', stableId: 'vst2:1' }]; },
		openPluginInstance: async () => { calls.push('x86-open'); return { native: false }; },
	};
	const context = { identity: { dev: 1, ino: 2 }, byteLength: 512, sha256: 'a'.repeat(64),
		resourcePolicy: { maximumInputBytes: 512, maximumJobDurationMs: 1_000, maximumRssBytes: 1024 ** 3,
			allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false } as const };
	let architecture: 'ia32' | 'x64' = 'ia32';
	const router = createWindowsVst2BridgeRouter({ nativePeer: native, bridgePeer: bridge, target: 'win-x64',
		readArchitecture: async () => architecture });
	assert.deepEqual(await router.inspectPluginCandidate('/legacy.dll', 'vst2', context),
		{ status: 'not-a-module', binaryArchitecture: 'ia32' });
	await assert.rejects(router.openPluginInstance('/legacy.dll', 48_000, 128, 'vst2', 'vst2:1', context), /disabled|consent/u);
	assert.deepEqual(calls, [], 'disabled bridging must not load the plugin');
	const allowed = { ...context, windowsX86Vst2: true as const };
	const descriptions = await router.inspectPluginCandidate('/legacy.dll', 'vst2', allowed);
	assert.ok(Array.isArray(descriptions));
	assert.deepEqual(descriptions[0], { status: 'ok', stableId: 'vst2:1', binaryArchitecture: 'ia32' });
	await router.openPluginInstance('/legacy.dll', 48_000, 128, 'vst2', 'vst2:1', allowed);
	architecture = 'x64';
	await router.openPluginInstance('/modern.dll', 48_000, 128, 'vst2', 'vst2:1', allowed);
	assert.deepEqual(calls, ['x86-scan', 'x86-open', 'native-open']);
	for (const target of ['win-arm64', 'linux-x64', 'mac-arm64']) {
		assert.throws(() => createWindowsVst2BridgeRouter({ nativePeer: native, bridgePeer: bridge, target }), /Windows x64/u);
	}
});
