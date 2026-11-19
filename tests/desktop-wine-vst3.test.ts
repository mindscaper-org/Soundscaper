/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { authenticatePluginCandidate } from '../desktop/plugin-candidate-authentication.mjs';
import { wineVst3Module, prepareWineVst3Bundle, createWineVst3Router } from '../desktop/wine-vst3-candidate.ts';
import { validateHelperJobGrant } from '../desktop/helper-job-grant.ts';
import { attachWineVst3Bridge } from '../desktop/wine-vst3-runtime.ts';
import { createSoundscaperProfessionalPluginPeer } from '../desktop/soundscaper-professional-plugin-peer.ts';

function pe(machine = 0x8664): Buffer {
	const bytes = Buffer.alloc(512);
	bytes.write('MZ'); bytes.writeUInt32LE(128, 0x3c); bytes.write('PE\0\0', 128, 'binary');
	bytes.writeUInt16LE(machine, 132); bytes.writeUInt16LE(machine === 0x14c ? 0x10b : 0x20b, 152);
	return bytes;
}

test('Wine bridge authority is explicit, VST3-only, and cannot be combined with the Windows x86 bridge', () => {
	const grant = { rootPath: '/plugins', format: 'vst3', identity: { dev: 1, ino: 2 }, linuxWineVst3: true };
	assert.equal(validateHelperJobGrant('plugin-scan', grant).linuxWineVst3, true);
	assert.throws(() => validateHelperJobGrant('plugin-scan', { ...grant, format: 'clap' }));
	for (const value of [false, 1, 'true', null]) {
		assert.throws(() => validateHelperJobGrant('plugin-scan', { ...grant, linuxWineVst3: value }));
	}
	assert.throws(() => validateHelperJobGrant('plugin-scan', { ...grant, windowsX86Vst2: true }));
});

test('merged bridge bundles retain the installed Windows module and authenticate its original identity', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-vst3-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const plugin = join(root, 'Example.vst3'); await writeFile(plugin, pe());
	assert.equal(await wineVst3Module(plugin), plugin);
	const original = await authenticatePluginCandidate(plugin);
	const library = join(root, 'libyabridge-vst3.so'); await writeFile(library, 'bridge');
	const prepared = await prepareWineVst3Bundle(plugin, original, { libraryPath: library, scratchRoot: root });
	assert.deepEqual(await readFile(join(prepared.path, 'Contents/x86_64-linux/Example.so')), Buffer.from('bridge'));
	assert.equal(await readlink(join(prepared.path, 'Contents/x86_64-win/Example.vst3')), plugin);
	await prepared.dispose();
	await assert.rejects(readFile(join(prepared.path, 'Contents/x86_64-linux/Example.so')));
	await writeFile(plugin, pe(0x14c));
	await assert.rejects(prepareWineVst3Bundle(plugin, original, { libraryPath: library, scratchRoot: root }), /changed/u);
	await assert.rejects(wineVst3Module(plugin), /64-bit/u);
	const bundle = join(root, 'Bundled.vst3');
	await mkdir(join(bundle, 'Contents/x86_64-win'), { recursive: true });
	await writeFile(join(bundle, 'Contents/x86_64-win/Bundled.vst3'), pe());
	assert.equal(await wineVst3Module(bundle), join(bundle, 'Contents/x86_64-win/Bundled.vst3'));
	const merged = await prepareWineVst3Bundle(bundle, await authenticatePluginCandidate(bundle), { libraryPath: library, scratchRoot: root });
	assert.equal(await readlink(join(merged.path, 'Contents/x86_64-win/Bundled.vst3')), join(bundle, 'Contents/x86_64-win/Bundled.vst3'),
		'yabridge must resolve a PE module before inspecting its architecture');
	await merged.dispose();
	await mkdir(join(bundle, 'Contents/x86_64-linux'), { recursive: true });
	await writeFile(join(bundle, 'Contents/x86_64-linux/Bundled.so'), '\u007fELF');
	assert.equal(await wineVst3Module(bundle), null, 'native Linux modules keep the native route');
});

test('only Linux x64 requests with explicit main-owned consent may execute a Windows VST3', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-router-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const plugin = join(root, 'Example.vst3'); await writeFile(plugin, pe());
	const calls: string[] = [];
	const native = { inspectPluginCandidate: async () => { calls.push('native'); return []; },
		openPluginInstance: async () => { calls.push('native-open'); return {}; } };
	const wine = { inspectPluginCandidate: async () => { calls.push('wine'); return []; },
		openPluginInstance: async () => { calls.push('wine-open'); return {}; } };
	const router = createWineVst3Router({ target: 'linux-x64', nativePeer: native, winePeer: wine });
	const context = { ...(await authenticatePluginCandidate(plugin)), resourcePolicy: {
		maximumInputBytes: 1024, maximumJobDurationMs: 1000, maximumRssBytes: 1024 ** 3,
		allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false } as const };
	await assert.rejects(router.openPluginInstance(plugin, 48000, 128, 'vst3', 'id', context), /consent/u);
	assert.deepEqual(calls, []);
	await router.inspectPluginCandidate(plugin, 'vst3', { ...context, linuxWineVst3: true });
	await router.openPluginInstance(plugin, 48000, 128, 'vst3', 'id', { ...context, linuxWineVst3: true });
	await router.inspectPluginCandidate(plugin, 'clap', context);
	assert.deepEqual(calls, ['wine', 'wine-open', 'native']);
	assert.throws(() => createWineVst3Router({ target: 'linux-arm64', nativePeer: native, winePeer: wine }));
});

test('an existing scanner rereads Wine configuration after enablement and revocation without restarting', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-configuration-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const plugin = join(root, 'Example.vst3'), configurationPath = join(root, 'runtime.json');
	await writeFile(plugin, pe()); await writeFile(configurationPath, 'null');
	const executable = { path: join(root, 'peer'), byteLength: 64, sha256: 'a'.repeat(64), identity: { dev: 1, ino: 2 } };
	const nativePeer = createSoundscaperProfessionalPluginPeer({ peerExecutable: executable, runtimeReadExecute: [],
		pluginFormats: ['vst3'], launcher: { launch: async () => { throw new Error('native execution must not occur'); } } });
	const scanner = await attachWineVst3Bridge({ nativePeer, peerExecutable: executable, entryExecutable: executable,
		entryArguments: [], runtimeClosure: [], configuration: { configurationPath } });
	const context = { ...(await authenticatePluginCandidate(plugin)), linuxWineVst3: true as const, resourcePolicy: {
		maximumInputBytes: 1024, maximumJobDurationMs: 1000, maximumRssBytes: 1024 ** 3,
		allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false } as const };
	await assert.rejects(scanner.inspectPluginCandidate(plugin, 'vst3', context), /hosting is disabled/u);
	await writeFile(configurationPath, '{}');
	await assert.rejects(scanner.inspectPluginCandidate(plugin, 'vst3', context), /manifest is unavailable/u,
		'the next request must observe the new configuration and authenticate its payload');
	await writeFile(configurationPath, 'null');
	await assert.rejects(scanner.inspectPluginCandidate(plugin, 'vst3', context), /hosting is disabled/u);
	await rm(configurationPath);
	await assert.rejects(scanner.inspectPluginCandidate(plugin, 'vst3', { ...context, linuxWineVst3: undefined }), /consent/u,
		'withheld main authority is rejected before accessing configuration or executing code');
});
