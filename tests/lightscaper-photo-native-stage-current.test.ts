/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { chmod, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { verifyDesktopLightscaperRawRuntimeCurrentV1 as wasm } from '../scripts/lib/desktop-lightscaper-raw-runtime-current-v1.ts';
import { photoNativeDeploymentFixtureCurrentV1 as fixture, PHOTO_NATIVE_TEST_CURRENT_V1 as options, PHOTO_NATIVE_MANIFEST_CURRENT_V1 as manifest,
	withPhotoNativeFileSyncCurrentV1 as synced } from './helpers/lightscaper-photo-native-deployment-fixture-current.ts';

void test('Photo native stage is the exact disjoint native plus unchanged pinned WASM closure', options, async context => fixture(context, async f => {
	const receipt = await f.stage(); assert.equal(receipt.target, f.result.target); assert.equal((await f.verify()).target, f.result.target);
	const after = await wasm({ runtimeRoot: f.runtimeRoot }); assert.equal(JSON.stringify(after), JSON.stringify(f.wasm));
	assert.ok((await readFile(join(f.applicationRoot, manifest))).byteLength > 0);
	assert.equal((await readdir(join(f.runtimeRoot, 'photo-native/current-v1'))).join(','), f.result.target);
}));

void test('foreign protected manifest refuses stage without mutating existing WASM or adding native prefix', options, async context => fixture(context, async f => {
	const sentinel = Buffer.from('foreign protected manifest\n'); await writeFile(join(f.applicationRoot, manifest), sentinel, { flag: 'wx' });
	await assert.rejects(f.stage()); assert.equal((await readFile(join(f.applicationRoot, manifest))).toString('hex'), sentinel.toString('hex'));
	assert.equal((await readdir(f.runtimeRoot)).join(','), 'libraw'); assert.equal(JSON.stringify(await wasm({ runtimeRoot: f.runtimeRoot })), JSON.stringify(f.wasm));
}));

void test('actual synced native copy followed by late foreign manifest rolls back only owned partial staging', options, async context => fixture(context, async f => {
	const path = join(f.applicationRoot, manifest), sentinel = Buffer.from('late foreign manifest\n');
	await synced(f.directory, async () => { await writeFile(path, sentinel, { flag: 'wx' }); }, async () => { await assert.rejects(f.stage()); });
	assert.equal((await readFile(path)).toString('hex'), sentinel.toString('hex'));
	assert.equal((await readdir(f.runtimeRoot)).join(','), 'libraw'); assert.equal(JSON.stringify(await wasm({ runtimeRoot: f.runtimeRoot })), JSON.stringify(f.wasm));
	await rm(path); await f.stage(); assert.equal((await f.verify()).target, f.result.target);
}));

void test('after-pack verification rechecks actual copied native bytes and production refuses null revision', options, async context => fixture(context, async f => {
	if (f.result.sourceRevision === null) {
		const { allowWorkingTree: _localOnly, ...production } = f.options;
		assert.equal(_localOnly, true); const module = await import('../scripts/lib/lightscaper-photo-native-stage-current-v1.ts'); await assert.rejects(module.stageLightscaperPhotoNativeCurrentV1(production));
	}
	await f.stage(); const path = join(f.runtimeRoot, 'photo-native/current-v1', f.result.target, f.result.roles['granted-filesystem'].payloadPath);
	await chmod(path, 0o700); const file = await open(path, 'r+');
	try { const byte = new Uint8Array(1); await file.read(byte, 0, 1, 0); byte[0] = byte[0]! ^ 1; await file.write(byte, 0, 1, 0); await file.sync(); } finally { await file.close(); }
	await assert.rejects(f.verify());
}));
