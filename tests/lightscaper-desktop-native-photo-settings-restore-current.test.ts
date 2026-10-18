/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { PhotoLibraryRestoreJournalOwnerV1 } from '../src/lightscaper/storage/photo-library-restore-journal-owner-v1.ts';
import { publishPhotoLibraryRestorePointerV1 } from '../src/lightscaper/storage/photo-library-restore-publication-v1.ts';
import { photoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1, PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1 as JOURNAL } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { photoLibraryRestoreNamespacesV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { nativePhotoSettingsFixtureCurrentV1 as fixture, observeNativePhotoSettingsSqlCurrentV1 as observe } from './helpers/lightscaper-native-photo-settings-integration-fixture-current.ts';

const POINTER = 'photo-library:default';
function restoration(letter = 'a') {
	const allocation = { schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
		operationId: letter.repeat(32), namespaceToken: letter.repeat(32), ownerToken: 'c'.repeat(32), catalogId: `catalog-${letter}` };
	const expectedPointer = { catalogId: 'old', kind: 'photo-library' as const, schemaVersion: 1 as const };
	const candidateReceipt = { schemaVersion: 1 as const, kind: 'photo-library-restore-ready' as const, catalogId: allocation.catalogId,
		...photoLibraryRestoreNamespacesV1(allocation), catalogRevision: 17, photoCount: 3, stackCount: 1,
		savedCollectionCount: 2, indexRevision: 0 as const, originalCount: 2, originalByteLength: 10 };
	const journal = { schemaVersion: 1, kind: 'photo-library-restore-journal', allocation, expectedPointer, phase: 'ready', candidateReceipt };
	const commit = photoLibraryRestoreCommitV1(journal), key = photoLibraryRestoreCommitKeyV1(allocation.namespaceToken);
	return { allocation, expectedPointer, candidateReceipt, journal, commit, key };
}

test('Lightscaper actual native anchor drives unchanged staging, ready, atomic pointer/history and journal retirement owners', async () => {
	await fixture(async f => {
		const r = restoration(); await f.values.put(POINTER, r.expectedPointer); let guarded = 0;
		const owner = new PhotoLibraryRestoreJournalOwnerV1(f.values, () => { guarded++; });
		await owner.stage(r.allocation, r.expectedPointer); assert.equal(owner.current?.phase, 'staging');
		assert.equal(await owner.canDiscard(), true); const ready = await owner.ready(r.candidateReceipt);
		assert.deepEqual(await f.values.get(JOURNAL), ready);
		const published = await publishPhotoLibraryRestorePointerV1({ settings: f.values, journal: ready, admitWrite: () => { guarded++; } });
		assert.equal(published.outcome, 'acknowledged'); assert.ok(guarded > 0);
		if (published.outcome === 'acknowledged') assert.equal(published.reconciled, false);
		assert.deepEqual(await f.values.get(POINTER), r.commit.replacementPointer); assert.deepEqual(await f.values.get(r.key), r.commit);
		assert.equal(await owner.canDiscard(), false); await owner.retire(); assert.equal(owner.current, null);
		assert.deepEqual(await f.values.readEntry(JOURNAL), { present: false });
		const later = { schemaVersion: 1, kind: 'photo-library', catalogId: 'later' } as const; await f.values.put(POINTER, later);
		const fresh = new PhotoLibraryRestoreJournalOwnerV1(f.values, () => undefined);
		await assert.rejects(fresh.stage(r.allocation, later), /permanent history/u);
		assert.deepEqual(await f.values.get(r.key), r.commit);
	});
});

test('Lightscaper two independent actual SQLite owners have one atomic pointer/history winner', async () => {
	await fixture(async f => {
		const other = await Settings.open({ appDataPath: f.appDataPath }), a = restoration('a'), b = restoration('b');
		try {
			await f.values.put(POINTER, a.expectedPointer);
			const results = await Promise.all([
				publishPhotoLibraryRestorePointerV1({ settings: f.values, journal: a.journal, admitWrite: () => undefined }),
				publishPhotoLibraryRestorePointerV1({ settings: other.settingsRepository, journal: b.journal, admitWrite: () => undefined }),
			]);
			assert.equal(results.filter(result => result.outcome === 'acknowledged').length, 1);
			const winner = results[0]!.outcome === 'acknowledged' ? a : b, loser = winner === a ? b : a;
			assert.deepEqual(await f.values.get(POINTER), winner.commit.replacementPointer);
			assert.deepEqual(await other.settingsRepository.get(winner.key), winner.commit);
			assert.deepEqual(await f.values.readEntry(loser.key), { present: false });
			assert.equal(f.control.prepare('SELECT COUNT(*) AS count FROM native_photo_settings').get()?.count, 2);
		} finally { await other.close(); }
	});
});

test('Lightscaper an already present malformed permanent history protects the exact pointer without being overwritten', async () => {
	await fixture(async f => {
		const r = restoration(); await f.values.put(POINTER, r.expectedPointer); await f.values.put(r.key, null);
		const result = await publishPhotoLibraryRestorePointerV1({ settings: f.values, journal: r.journal, admitWrite: () => undefined });
		assert.equal(result.outcome, 'protected-uncertain'); assert.deepEqual(await f.values.get(POINTER), r.expectedPointer);
		assert.deepEqual(await f.values.readEntry(r.key), { present: true, value: null });
	});
});

test('Lightscaper selected labels cannot use the fixed-anchor atomic publication method', async () => {
	await fixture(async f => {
		const selected = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:restored.a' }), r = restoration();
		try {
			await selected.settingsRepository.put(POINTER, r.expectedPointer); await f.values.put(POINTER, r.expectedPointer);
			await assert.rejects(selected.settingsRepository.replaceIfCurrentAndPutIfAbsent(POINTER, r.expectedPointer, r.commit.replacementPointer, r.key, r.commit));
			assert.deepEqual(await selected.settingsRepository.get(POINTER), r.expectedPointer);
			assert.deepEqual(await selected.settingsRepository.readEntry(r.key), { present: false });
			assert.deepEqual(await f.values.get(POINTER), r.expectedPointer); assert.deepEqual(await f.values.readEntry(r.key), { present: false });
		} finally { await selected.close(); }
	});
});

test('Lightscaper queued atomic pair captures expected, replacement and history before borrowed mutation and Close', async () => {
	await fixture(async f => {
		const r = restoration(), expected = structuredClone(r.expectedPointer), replacement = structuredClone(r.commit.replacementPointer), history = structuredClone(r.commit);
		const initial = f.values.put(POINTER, r.expectedPointer);
		const published = f.values.replaceIfCurrentAndPutIfAbsent(POINTER, expected, replacement, r.key, history);
		expected.catalogId = 'mutated'; Reflect.set(replacement, 'catalogId', 'mutated'); Reflect.set(history.allocation, 'ownerToken', 'd'.repeat(32));
		const closing = f.owner.close(); await initial; assert.equal(await published, true); await closing;
		const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try {
			assert.deepEqual(await reopened.settingsRepository.get(POINTER), r.commit.replacementPointer);
			assert.deepEqual(await reopened.settingsRepository.get(r.key), r.commit);
		} finally { await reopened.close(); }
	});
});

test('Lightscaper actual SQLite second INSERT refusal rolls back the pair and permits a genuine later retry', async () => {
	await fixture(async f => {
		const r = restoration(); await f.values.put(POINTER, r.expectedPointer);
		f.control.exec("CREATE TRIGGER native_settings_test_refusal BEFORE INSERT ON native_photo_settings WHEN NOT EXISTS (SELECT 1 FROM native_photo_settings WHERE scope=NEW.scope AND key=NEW.key) BEGIN SELECT RAISE(ABORT, 'Native settings INSERT refused.'); END");
		try {
			await assert.rejects(f.values.replaceIfCurrentAndPutIfAbsent(POINTER, r.expectedPointer, r.commit.replacementPointer, r.key, r.commit), /Native settings INSERT refused/u);
			assert.deepEqual(await f.values.get(POINTER), r.expectedPointer); assert.deepEqual(await f.values.readEntry(r.key), { present: false });
		} finally { f.control.exec('DROP TRIGGER native_settings_test_refusal'); }
		assert.equal(await f.values.replaceIfCurrentAndPutIfAbsent(POINTER, r.expectedPointer, r.commit.replacementPointer, r.key, r.commit), true);
	});
});

test('Lightscaper real deferred-FK COMMIT failure rolls back pointer, history and trigger writes together', async () => {
	await fixture(async f => {
		const r = restoration(); await f.values.put(POINTER, r.expectedPointer);
		f.control.exec(`CREATE TABLE native_settings_test_parent(id INTEGER PRIMARY KEY);
			CREATE TABLE native_settings_test_child(id INTEGER REFERENCES native_settings_test_parent(id) DEFERRABLE INITIALLY DEFERRED);
			CREATE TRIGGER native_settings_test_commit AFTER INSERT ON native_photo_settings BEGIN INSERT INTO native_settings_test_child(id) VALUES(1); END`);
		try {
			await assert.rejects(f.values.replaceIfCurrentAndPutIfAbsent(POINTER, r.expectedPointer, r.commit.replacementPointer, r.key, r.commit), /FOREIGN KEY constraint failed/u);
			assert.deepEqual(await f.values.get(POINTER), r.expectedPointer); assert.deepEqual(await f.values.readEntry(r.key), { present: false });
			assert.equal(f.control.prepare('SELECT COUNT(*) AS count FROM native_settings_test_child').get()?.count, 0);
		} finally { f.control.exec('DROP TRIGGER native_settings_test_commit; DROP TABLE native_settings_test_child; DROP TABLE native_settings_test_parent'); }
		assert.equal(await f.values.replaceIfCurrentAndPutIfAbsent(POINTER, r.expectedPointer, r.commit.replacementPointer, r.key, r.commit), true);
	});
});

test('Lightscaper actual pair COMMIT acknowledgement survives reentrant drain-close without reconciliation', async () => {
	await fixture(async f => {
		const r = restoration(); await f.values.put(POINTER, r.expectedPointer); let closing: Promise<void> | undefined, commits = 0;
		const result = await observe(f.databasePath, (_database, sql) => {
			if (sql === 'COMMIT') { commits++; closing = f.owner.close(); assert.equal(f.owner.close(), closing); }
		}, () => publishPhotoLibraryRestorePointerV1({ settings: f.values, journal: r.journal, admitWrite: () => undefined }));
		assert.equal(commits, 1); assert.ok(closing); assert.equal(result.outcome, 'acknowledged');
		if (result.outcome === 'acknowledged') { assert.equal(result.reconciled, false); assert.deepEqual(result.errors, []); }
		await closing; const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try {
			assert.deepEqual(await reopened.settingsRepository.get(POINTER), r.commit.replacementPointer);
			assert.deepEqual(await reopened.settingsRepository.get(r.key), r.commit);
		} finally { await reopened.close(); }
	});
});
