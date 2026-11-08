/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoLibraryCullingNavigationContextV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import { PhotoLibrarySessionCurrentV1 as Session } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import { nativeSessionClientFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-native-session-client-integration-fixture-current.ts';

void test('Complete protocol desktop factory returns actual Current class and all children backed by real selected storage and fixed anchor presets', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const session = await f.open(); assert.ok(session instanceof Session); assert.equal(Object.hasOwn(session, 'close'), true);
		for (const name of ['develop', 'legacyDevelop', 'developImport', 'developImportCurrent', 'cubeLuts', 'maskRasterSource', 'imageHandoff', 'imageHandoffCurrent',
			'imageReceive', 'imageReceiveCurrent', 'collectionHandoff', 'collectionHandoffCurrent', 'batchRenameCurrent', 'cullingNavigation', 'exportJournal', 'exportJournalCurrent',
			'exportPresets', 'exportPresetsCurrent', 'savedCollections', 'hdrMergeCurrent']) assert.notEqual(Reflect.get(session, name), undefined, `Complete Current child ${name}`);
		assert.ok(session.develop.original); assert.ok(session.develop.settingsCurrent); assert.ok(session.develop.presetsCurrent);
		const page = await session.readPage(); assert.equal(page.totalCount, 3); assert.equal(page.catalogName, 'Native complete Session');
		const photo = f.photos[0]!, rated = await session.setRating(photo.id, 4); assert.equal(rated.rating, 4);
		const metadata = await session.readMetadata(photo.id), edited = await session.applyMetadata(photo.id, metadata.revision, { title: 'Actual native Session edit' });
		assert.equal(edited.metadata.title, 'Actual native Session edit'); assert.equal(edited.revision, metadata.revision + 1);
		const develop = await session.develop.read({ schemaVersion: 3, photoId: photo.id }); assert.equal(develop.develop.processVersion, 4);
		assert.ok(session.legacyDevelop); await assert.rejects(session.legacyDevelop.read({ schemaVersion: 2, photoId: photo.id }));
		const presets = await session.readImportPresets(), saved = await session.applyImportPreset({ type: 'save', expectedRevision: presets.revision,
			id: 'actual-native-import-preset', name: 'Native preset', settings: { rename: null, metadata: { creator: 'Native author' }, keywordIds: [] } });
		assert.equal(saved.revision, presets.revision + 1); assert.equal(saved.presets[0]?.name, 'Native preset');
		const key = photoImportPresetsKeyV1(f.selected.catalogId), anchor = await Settings.open({ appDataPath: f.directory, scope: 'anchor' });
		try { assert.equal((await anchor.settingsRepository.readEntry(key)).present, true); } finally { await anchor.close(); }
		const selectedSettings = await Settings.open({ appDataPath: f.directory, scope: 'selected:library' });
		try { assert.equal((await selectedSettings.settingsRepository.readEntry(key)).present, false, 'Fixed import presets must not drift into selected settings.'); } finally { await selectedSettings.close(); }
		const closing = session.close(); assert.equal(session.close(), closing); await closing; await assert.rejects(session.readPage());
		await f.reopen(); const reopened = await f.open();
		assert.equal((await reopened.readMetadata(photo.id)).metadata.title, 'Actual native Session edit'); assert.equal((await reopened.readImportPresets()).presets[0]?.name, 'Native preset');
	});
});

void test('Complete protocol Current factory executes both native queries, stack publication, saved queries and all culling modes on real SQL', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const session = await f.open(), query = { text: '', filter: null, sort: { field: 'photo-id', direction: 'ascending' } } as const;
		const query2 = { ...query, schemaVersion: 2, kind: 'photo-catalog-query', predicate: null } as const;
		assert.equal((await session.rebuildQueryStep()).ready, true); assert.equal((await session.rebuildQueryStepV2()).ready, true);
		assert.equal((await session.readQueryStep({ query })).rows.length, 3); assert.equal((await session.readQueryStepV2({ query: query2 })).rows.length, 3);
		const members = await session.readStackMemberships(f.photos.slice(0, 2).map(photo => photo.id));
		const stack = await session.applyStack({ schemaVersion: 1, type: 'create', catalogId: f.selected.catalogId,
			expectedCatalogRevision: members.context.catalogRevision, expectedStateRevision: members.context.stateRevision,
			photoIds: f.photos.slice(0, 2).map(photo => photo.id), coverPhotoId: f.photos[0]!.id });
		assert.equal(stack.action, 'created'); assert.equal((await session.readStackSummaryPage()).rows.length, 1);
		assert.equal((await session.readStackQueryStep({ query })).rows.length, 2); assert.equal((await session.readStackQueryStepV2({ query: query2 })).rows.length, 2);
		const saved = session.savedCollections; assert.ok(saved); const initial = await saved.readSnapshot({ collectionId: null });
		const created = await saved.apply({ type: 'create', context: initial.context, name: 'Native saved all', queryJson: JSON.stringify(normalizePhotoCatalogQueryV2({
			schemaVersion: 2, kind: 'photo-catalog-query', sort: query.sort })) });
		assert.equal(created.outcome, 'created'); assert.equal((await saved.readPage()).items[0]?.id, created.collectionId);
		assert.equal((await saved.readQueryStep({ collectionId: created.collectionId, mode: 'ordinary' })).rows.length, 3);
		assert.equal((await saved.readQueryStep({ collectionId: created.collectionId, mode: 'collapsed' })).rows.length, 2);
		const navigation = session.cullingNavigation; assert.ok(navigation);
		const contexts: readonly PhotoLibraryCullingNavigationContextV1[] = [{ kind: 'plain' }, ...[query, query2].flatMap(value => [false, true].map(collapsed => ({ kind: 'query' as const, query: value, collapsed }))),
			...[false, true].map(collapsed => ({ kind: 'saved' as const, collectionId: created.collectionId, collapsed }))];
		for (const binding of contexts) {
			const destination = await navigation.readDestinationPage(binding, { photoId: f.photos[0]!.id }); assert.ok(destination); assert.equal(destination.rows[0]?.id, f.photos[0]!.id);
		}
	});
});
