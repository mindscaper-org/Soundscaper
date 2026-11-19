/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { readLightscaperNativePhotoMediaRestoreReceiptCurrentV1 as readReceipt,
	createLightscaperNativePhotoMediaRestoreStageCurrentV1 as createMedia } from '../desktop/lightscaper-native-photo-media-restore-stage-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { nativeMediaRestoreFixtureCurrentV1 as fixture, mediaRestoreShaCurrentV1 as sha,
	catalogReceipt, Media, Settings } from './helpers/lightscaper-native-media-restore-integration-fixture-current.ts';

// Storage restoration preserves real encoded bytes and complete recipes; these
// tests make no positive decoder/render/pixel claim.
void test('Native restore streams every alias, installs late complete resources/presets, audits and reopens actual files/SQLite', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); assert.deepEqual(f.consumed, f.photos.map(photo => photo.id));
		await f.writeResources(); const records = await f.catalog.finish(), receipt = await f.finish();
		assert.deepEqual(Object.keys(receipt).sort(), ['catalogId', 'catalogInventorySha256', 'inventorySha256', 'originalByteLength', 'originalCount', 'photoCount']);
		assert.equal(receipt.catalogId, f.root.id); assert.equal(receipt.photoCount, 3); assert.equal(receipt.originalCount, 2);
		assert.equal(receipt.originalByteLength, f.values[0]!.length + f.values[2]!.length);
		assert.match(receipt.inventorySha256, /^[a-f0-9]{64}$/u);
		assert.equal(receipt.catalogInventorySha256, catalogReceipt(records, f.candidate.allocation).inventorySha256);
		assert.equal(readReceipt(receipt, f.candidate.allocation), receipt); assert.equal(await f.finish(), receipt);
		await f.candidate.close(); assert.equal(readReceipt(receipt, f.candidate.allocation), receipt);
		assert.throws(() => readReceipt(structuredClone(receipt), f.candidate.allocation));
		const other = await f.reopen(); assert.deepEqual(await other.catalog.loadCatalog(f.root.id), f.root);
		for (const [index, photo] of f.photos.entries()) {
			assert.deepEqual(await other.catalog.loadPhoto(photo.catalogId, photo.id), photo);
			await other.media.verifyOriginal(photo.original); const actual = new Uint8Array(await readFile(lightscaperNativePhotoOriginalBodyPathCurrentV1(f.paths.originals, photo.original.contentSha256)));
			assert.equal(actual.byteLength, f.values[index]!.byteLength); assert.equal(sha(actual), photo.original.contentSha256);
			await (await other.resources.cubeLutResources()).verifyPhoto(photo, context.signal);
			await (await other.resources.maskRasterResources()).verifyPhoto(photo, context.signal);
		}
		assert.deepEqual(await other.settings.settingsRepository.readEntry(photoDevelopPresetsKeyV1(f.root.id)), { present: true, value: f.row });
		const roots = await other.media.catalogOriginals.readPage({ catalogId: f.root.id }); assert.equal(roots.roots.length, 3);
		assert.ok(roots.roots.every(root => root.importId === null)); assert.deepEqual(roots.roots.map(root => root.sourceId).sort(), f.photos.map(photo => photo.original.id).sort());
		assert.equal((await other.media.catalogOriginals.readPage({ catalogId: f.root.id, importId: f.candidate.allocation.operationId })).roots.length, 0);
	});
});

for (const preset of ['absent', 1, 2, 3, 4] as const) void test(`Native restore preserves exact ${preset === 'absent' ? 'absent' : `positive empty Row${preset}`} preset state`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); await f.catalog.finish(); await f.finish();
		const owners = await f.reopen(), entry = await owners.settings.settingsRepository.readEntry(photoDevelopPresetsKeyV1(f.root.id));
		assert.deepEqual(entry, f.row === null ? { present: false } : { present: true, value: f.row });
	}, { preset });
});

void test('Native restore fully hashes a later same-key alias and refuses mismatched bytes before it can acquire custody', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writeOriginal(0); await f.catalog.writePhoto(f.photos[0]!);
		await assert.rejects(f.writeOriginal(1, f.chunks(1, bytes => { bytes[bytes.length - 1] = bytes.at(-1)! ^ 1; return bytes; })), /digest|SHA|identity/iu);
		const owner = await Media.open({ appDataPath: f.appDataPath });
		try { assert.equal((await owner.catalogOriginals.readPage({ catalogId: f.root.id, importId: f.candidate.allocation.operationId })).roots.length, 1); }
		finally { await owner.close(); }
	});
});

void test('Native restore crosses real 4MiB input and 1MiB physical chunks with exact length/SHA and candidate-local alias reuse', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const first = await f.writeOriginal(0), alias = await f.writeOriginal(1);
		assert.equal(first.reused, false); assert.equal(alias.reused, true); assert.equal(first.size, 4 * 1024 * 1024 + 137);
		assert.equal(first.sha256, sha(f.values[0]!)); assert.deepEqual(f.consumed, f.photos.slice(0, 2).map(photo => photo.id));
	}, { length: 4 * 1024 * 1024 + 137 });
});

for (const fault of ['body', 'retained-lut', 'unused-brush', 'extra-asset', 'extra-root', 'extra-setting', 'preset-rewrite'] as const) void test(`Native restore final real inventory audit refuses ${fault}`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); await f.catalog.finish();
		if (fault === 'body') {
			const photo = f.photos[0]!, path = lightscaperNativePhotoOriginalBodyPathCurrentV1(f.paths.originals, photo.original.contentSha256);
			const bytes = new Uint8Array(await readFile(path)); bytes[0] = bytes[0]! ^ 1; await writeFile(path, bytes);
		} else if (fault === 'retained-lut') f.sql('resources', db => { db.prepare('DELETE FROM native_photo_resources WHERE storage_key=?').run(f.bundles[1]!.lut.reference.storageKey); });
		else if (fault === 'unused-brush') f.sql('resources', db => { db.prepare('DELETE FROM native_photo_resources WHERE storage_key=?').run(f.bundles.at(-1)!.brushes[1]!.reference.storageKey); });
		else if (fault === 'extra-asset' || fault === 'extra-root') {
			const owner = await Media.open({ appDataPath: f.appDataPath });
			try {
				if (fault === 'extra-asset') await owner.writeAsset('unarchived-asset', new Blob([f.values[0]!]));
				else await owner.catalogOriginals.retain(f.root.id, [{ photoId: 'unarchived-photo', sourceId: 'unarchived-source', assetId: f.photos[0]!.original.storageKey,
					sha256: f.photos[0]!.original.contentSha256, size: f.photos[0]!.original.byteLength }]);
			} finally { await owner.close(); }
		} else {
			const settings = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:library' });
			try { if (fault === 'extra-setting') await settings.settingsRepository.put('unarchived-setting', { exact: true });
				else { assert.ok(f.row); const row = { ...f.row, presets: f.row.presets.map(preset => ({ ...preset, identity: { ...preset.identity, name: 'Same header replacement' } })) };
					await settings.settingsRepository.put(photoDevelopPresetsKeyV1(f.root.id), row); } }
			finally { await settings.close(); }
		}
		await assert.rejects(f.finish());
	});
});

for (const kind of ['unsealed', 'copied'] as const) void test(`Native media finish refuses ${kind} catalog authority`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); if (kind === 'copied') await f.catalog.finish();
		await assert.rejects(f.media.finish(kind === 'copied' ? { ...f.catalog } : f.catalog));
	});
});

void test('Native media receipt WeakMap refusal does not reflect opaque copied authority', () => {
	let traps = 0; const opaque = new Proxy({}, { get() { traps++; throw new Error('Reflected opaque receipt'); }, getPrototypeOf() { traps++; throw new Error('Reflected opaque receipt'); } });
	assert.throws(() => readReceipt(opaque, {})); assert.equal(traps, 0);
});

void test('Native media constructor refuses forged claim before borrowed options getters', async () => {
	let traps = 0; const options = new Proxy({}, { ownKeys() { traps++; throw new Error('Reflected options'); }, getOwnPropertyDescriptor() { traps++; throw new Error('Reflected options'); } });
	await assert.rejects(Reflect.apply(createMedia, undefined, [{}, options]) as Promise<unknown>); assert.equal(traps, 0);
});
