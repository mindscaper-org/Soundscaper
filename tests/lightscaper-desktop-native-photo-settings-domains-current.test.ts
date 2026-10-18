/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { applyPhotoImportPresetV1, readPhotoImportPresetsV1, normalizePhotoImportPresetRowV1, photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { applyPhotoDevelopPresetCurrentV1, readPhotoDevelopPresetCurrentV1 } from '../src/lightscaper/storage/photo-develop-presets-current-v1.ts';
import { capturePhotoDevelopPresetsArchiveCurrentV1 } from '../src/lightscaper/storage/photo-develop-presets-archive-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createImageDevelopPresetForProfileV1 } from '../src/common/editor/imaging/internal/image-develop-preset-kernel-v1.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportJournalOwnerCurrentV1 as ExportJournal } from '../src/lightscaper/storage/photo-raster-export-journal-owner-current-v1.ts';
import { PhotoRasterExportJournalErrorV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { nativePhotoSettingsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-photo-settings-integration-fixture-current.ts';

test('Lightscaper native anchor satisfies the unchanged import preset writer and exact row revision conflicts', async () => {
	await fixture(async f => {
		const other = await Settings.open({ appDataPath: f.appDataPath }), root = queryCatalogRootV1();
		const save = (id: string) => ({ type: 'save', expectedRevision: 0, id, name: `Import ${id}`, settings: { rename: null, metadata: {}, keywordIds: ['keyword'] } });
		try {
			const result = await Promise.allSettled([applyPhotoImportPresetV1(f.values, root, save('first')), applyPhotoImportPresetV1(other.settingsRepository, root, save('second'))]);
			assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
			const rejected = result.find(value => value.status === 'rejected'); assert.ok(rejected && rejected.status === 'rejected');
			assert.equal((rejected.reason as { code: string }).code, 'IMPORT_PRESET_REVISION_CONFLICT');
			const selected = await readPhotoImportPresetsV1(f.values, 'catalog'); assert.equal(selected.revision, 1); assert.equal(selected.presets.length, 1);
			const deleted = await applyPhotoImportPresetV1(other.settingsRepository, root, { type: 'delete', expectedRevision: 1, id: selected.presets[0]!.id });
			assert.deepEqual(deleted, { revision: 2, presets: [] });
		} finally { await other.close(); }
	});
});

test('Lightscaper native settings persists and reopens an actual valid ten-MiB-class preset row with legal lone UTF16', async () => {
	await fixture(async f => {
		const maxId = (index: number) => `k${String(index).padStart(4, '0')}${'a'.repeat(123)}`, text = '\ud800'.repeat(16_384);
		const settings = { rename: { template: '\ud800'.repeat(256), sequenceStart: Number.MAX_SAFE_INTEGER - 63, sequencePadding: 16 },
			metadata: { title: text, caption: text, creator: text, copyright: text, location: text }, keywordIds: Array.from({ length: 1024 }, (_, index) => maxId(index)) };
		const catalogId = 'c'.repeat(128), row = normalizePhotoImportPresetRowV1({ schemaVersion: 1, kind: 'photo-import-presets', catalogId, revision: Number.MAX_SAFE_INTEGER,
			presets: Array.from({ length: 16 }, (_, index) => ({ id: maxId(index), name: '\ud800'.repeat(256), settings })) }, catalogId);
		assert.equal(new TextEncoder().encode(JSON.stringify(row)).byteLength, 10_065_352);
		assert.equal(await f.values.putIfAbsent(photoImportPresetsKeyV1(catalogId), row), true); await f.owner.close();
		const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try {
			const raw = await reopened.settingsRepository.get(photoImportPresetsKeyV1(catalogId));
			assert.deepEqual(normalizePhotoImportPresetRowV1(raw, catalogId), row);
			assert.deepEqual(await readPhotoImportPresetsV1(reopened.settingsRepository, catalogId), { revision: row.revision, presets: row.presets });
		} finally { await reopened.close(); }
	});
});

function selectedPreset(version: 3 | 4) {
	const base = { ...defaultImageDevelopStateV1(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } };
	const develop = version === 3 ? normalizeImageDevelopStateV3(base) : normalizeImageDevelopStateV4({ ...base, processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'canonical' } });
	const request = { schemaVersion: version, id: `preset${String(version)}`, name: `Selected ${String(version)}`,
		settings: { schemaVersion: version, kind: 'photo-develop-settings', develop,
			selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true, ...(version === 4 ? { rawDevelopment: true } : {}) } } };
	return version === 3 ? createImageDevelopPresetForProfileV1('current3', request, 'selected')
		: createImageDevelopPresetForProfileV1('current4', request, 'selected');
}

for (const version of [3, 4] as const) test(`Lightscaper native selected preset${String(version)} retains actual row/absence/digest archive proof without touching the anchor`, async () => {
	await fixture(async f => {
		const selected = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:restored.a' });
		const other = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:restored.a' });
		const key = photoDevelopPresetsKeyV1('catalog'), preset = selectedPreset(version);
		try {
			const absent = await capturePhotoDevelopPresetsArchiveCurrentV1(selected.settingsRepository, 'catalog'); assert.equal(absent.row, null);
			await absent.verify(); await applyPhotoDevelopPresetCurrentV1(selected.settingsRepository, queryCatalogRootV1(), { type: 'save', expectedRevision: 0, preset });
			await assert.rejects(absent.verify(), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
			assert.deepEqual((await readPhotoDevelopPresetCurrentV1(other.settingsRepository, 'catalog', preset.identity.id, 1)).preset, preset);
			const captured = await capturePhotoDevelopPresetsArchiveCurrentV1(selected.settingsRepository, 'catalog');
			assert.equal(captured.row?.schemaVersion, version); await captured.verify();
			const row = normalizePhotoDevelopPresetRowCurrentV1(await other.settingsRepository.get(key), 'catalog');
			assert.equal(await other.settingsRepository.replaceIfCurrent(key, row, { ...row, revision: row.revision + 1 }), true);
			await assert.rejects(captured.verify(), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
			assert.deepEqual(await f.values.readEntry(key), { present: false });
			await other.settingsRepository.put(key, undefined);
			assert.deepEqual(await selected.settingsRepository.readEntry(key), { present: true, value: undefined });
			await assert.rejects(capturePhotoDevelopPresetsArchiveCurrentV1(selected.settingsRepository, 'catalog'), /value/iu);
		} finally { await Promise.all([selected.close(), other.close()]); }
	});
});

test('Lightscaper selected import intent transport survives reopen and exact CAS refuses a different recovery owner', async () => {
	await fixture(async f => {
		const selected = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:restored.a' }), key = photoImportIntentKeyV1('catalog');
		const intent = normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId: 'catalog', importId: 'first-import' }, 'catalog');
		try { assert.equal(await selected.settingsRepository.putIfAbsent(key, intent), true); } finally { await selected.close(); }
		const reopened = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:restored.a' });
		try {
			assert.deepEqual(normalizePhotoImportIntentV1(await reopened.settingsRepository.get(key), 'catalog'), intent);
			assert.equal(await reopened.settingsRepository.deleteIfCurrent(key, { ...intent, importId: 'foreign' }), false);
			assert.deepEqual(await f.values.readEntry(key), { present: false }); assert.equal(await reopened.settingsRepository.deleteIfCurrent(key, intent), true);
		} finally { await reopened.close(); }
		// This is persistent intent transport, not a substitute for native custody recovery.
	});
});

for (const companion of [false, true]) test(`Lightscaper actual native Current ${companion ? 'JSON' : 'image'} journal requires one positive claim ACK across identical independent writers`, async () => {
	await fixture(async f => {
		const a = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:export.a' }), b = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:export.a' });
		const first = new ExportJournal(a.settingsRepository, 'catalog'), second = new ExportJournal(b.settingsRepository, 'catalog');
		try {
			const filenameTemplate = '{name}', plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'settings-native', format: 'png', filenameTemplate,
				...(companion ? { sidecarEnabled: true } : {}), members: [{ photoId: 'photo', versionId: 'master', expectedRevision: 2, sourceFileName: 'One.png' }] });
			const journal = createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog', filenameTemplate,
				bindings: [{ originalSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64), lutSha256: [], ...(companion ? { sidecarSha256: 'd'.repeat(64) } : {}) }] });
			await first.create(journal); const member = journal.members[0]!;
			if (companion) { await first.started(member.jobId); await first.committed(member.jobId, { status: 'download-started', method: 'download', fileName: member.fileName, size: 4 }); }
			await second.load();
			const result = await Promise.allSettled([companion ? first.sidecarStarted(member.jobId) : first.started(member.jobId), companion ? second.sidecarStarted(member.jobId) : second.started(member.jobId)]);
			assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
			const rejected = result.find(value => value.status === 'rejected'); assert.ok(rejected && rejected.status === 'rejected'); assert.ok(rejected.reason instanceof PhotoRasterExportJournalErrorV1);
			const reloaded = await second.load(); assert.equal(companion ? reloaded?.members[0]?.sidecar?.state : reloaded?.members[0]?.state, 'started');
			await assert.rejects(companion ? second.sidecarStarted(member.jobId) : second.started(member.jobId));
			// No image/download is fabricated: these are the genuine scalar claim owners.
		} finally { await Promise.all([first.closeAndJoin(), second.closeAndJoin()]); await Promise.all([a.close(), b.close()]); }
	});
});
