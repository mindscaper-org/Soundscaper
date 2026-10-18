/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopPhotoLibrarySessionCurrentV1 as create } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import type { PhotoLibrarySessionCurrentV1 as Session } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service } from '../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';

const options = { timeout: 15_000 };

void test('Native Current startup uses the actual bounded intent reader and canonical real recovery CAS', options, async context => {
	await fixture(context, async f => {
		let genericGets = 0, session: Session | undefined;
		const service: Service = { async open(input, owner) {
			const actual = await f.service.open(input, owner), selected = actual.components.settings;
			return Object.freeze({ ...actual, components: Object.freeze({ ...actual.components, settings: Object.freeze({ ...selected,
				settingsRepository: Object.freeze({ ...selected.settingsRepository, get: async () => { genericGets++; throw new Error('Unbounded generic intent read.'); } }) }) }) });
		} };
		try {
			session = await f.track(create({ name: 'Actual bounded native recovery', service, originalSourceOptions: { storage: f.storage.storage } }));
			const key = photoImportIntentKeyV1(f.selected.catalogId), intent = { schemaVersion: 1, kind: 'photo-import', catalogId: f.selected.catalogId, importId: 'actual-startup' };
			await f.components.settings.settingsRepository.put(key, intent);
			assert.equal((await session.readPage()).totalCount, f.photos.length); assert.equal(genericGets, 0);
			assert.deepEqual(await f.components.settings.settingsRepository.readEntry(key), { present: false });
		} finally { await session?.close(); }
	});
});

for (const value of ['undefined', 'oversized'] as const) void test(`Native Current startup protects occupied ${value} intent without generic decode or false absence`, options, async context => {
	await fixture(context, async f => {
		const session = await f.open(), key = photoImportIntentKeyV1(f.selected.catalogId);
		try {
			await f.components.settings.settingsRepository.put(key, value === 'undefined' ? undefined : new Blob([new Uint8Array(8192)]));
			await assert.rejects(session.readPage(), value === 'undefined' ? TypeError : RangeError);
			const actual = await f.components.settings.settingsRepository.readEntry(key); assert.equal(actual.present, true);
			if (actual.present) { if (value === 'undefined') assert.equal(actual.value, undefined); else { assert.ok(actual.value instanceof Blob); assert.equal(actual.value.size, 8192); } }
			assert.equal((await f.components.catalog.loadCatalog(f.selected.catalogId))?.photoCount, f.photos.length);
		} finally { await session.close(); }
	});
});

void test('Native Current bounded recovery preserves reordered intent bytes and refuses its normalized deletion CAS', options, async context => {
	await fixture(context, async f => {
		const session = await f.open(), key = photoImportIntentKeyV1(f.selected.catalogId);
		const raw = { importId: 'same-values-different-order', catalogId: f.selected.catalogId, kind: 'photo-import', schemaVersion: 1 };
		try {
			await f.components.settings.settingsRepository.put(key, raw);
			await assert.rejects(session.readPage(), /changed before retirement/iu);
			const entry = await f.components.settings.settingsRepository.readEntry(key); assert.equal(entry.present, true);
			if (entry.present) { assert.deepEqual(Object.keys(entry.value as object), Object.keys(raw)); assert.deepEqual(entry.value, raw); }
		} finally { await session.close(); }
	});
});
