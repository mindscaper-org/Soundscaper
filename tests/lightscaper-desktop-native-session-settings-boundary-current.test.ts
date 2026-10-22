/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { normalizePhotoImportPresetRowV1, photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { nativeSessionProtocolFixtureCurrentV1 as fixture, channels } from './helpers/lightscaper-native-session-protocol-integration-fixture-current.ts';

void test('Main fixed-anchor domain retains a legal ten-MiB-class preset row and lone UTF16 through native framing', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const anchor = await Settings.open({ appDataPath: f.directory });
		const catalog = f.selected.catalogId, maxId = (index: number) => `k${String(index).padStart(4, '0')}${'a'.repeat(123)}`, text = '\ud800'.repeat(16_384);
		const settings = { rename: { template: '\ud800'.repeat(256), sequenceStart: Number.MAX_SAFE_INTEGER - 63, sequencePadding: 16 },
			metadata: { title: text, caption: text, creator: text, copyright: text, location: text }, keywordIds: Array.from({ length: 1024 }, (_, index) => maxId(index)) };
		const row = normalizePhotoImportPresetRowV1({ schemaVersion: 1, kind: 'photo-import-presets', catalogId: catalog, revision: Number.MAX_SAFE_INTEGER,
			presets: Array.from({ length: 16 }, (_, index) => ({ id: maxId(index), name: '\ud800'.repeat(256), settings })) }, catalog);
		assert.ok(new TextEncoder().encode(JSON.stringify(row)).byteLength > 10_000_000);
		try {
			assert.equal(await anchor.settingsRepository.putIfAbsent(photoImportPresetsKeyV1(catalog), row), true);
			const value = await f.call(channels.settings, { operation: 'get', domain: 'import-presets' });
			const actual = normalizePhotoImportPresetRowV1(value, catalog);
			assert.equal(actual.revision, row.revision); assert.equal(actual.presets.length, 16);
			// One bounded recipe at a time; failure cannot print the whole row.
			for (let index = 0; index < row.presets.length; index++) {
				const expectedDigest = createHash('sha256').update(JSON.stringify(row.presets[index])).digest('hex');
				const actualDigest = createHash('sha256').update(JSON.stringify(actual.presets[index])).digest('hex');
				assert.equal(actualDigest, expectedDigest, `preset ${String(index)} retains exact UTF16 and fields`);
			}
		} finally { await anchor.close(); }
	});
});
