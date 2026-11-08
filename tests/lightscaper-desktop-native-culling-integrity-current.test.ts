/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { type DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import test from 'node:test';
import { readLightscaperNativeCullingDestinationPageCurrentV1 as read, readAdmittedLightscaperNativeCullingDestinationPageCurrentV1 as readAdmitted } from '../desktop/lightscaper-native-culling-current-v1.ts';
import { admitLightscaperNativeCullingNavigationCurrentV1 as admit } from '../desktop/lightscaper-native-culling-admission-current-v1.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1 as Context } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import { nativeCullingFixtureCurrentV1 as fixture, seedNativeCullingCurrentV1 as seed,
	CATALOG, key, photoId, queryV1, queryV2 } from './helpers/lightscaper-native-culling-fixture-current.ts';
import { overflowLegacyQueryPhotoCurrentV1, replaceLegacyQuerySourceCurrentV1 } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';

const contexts: readonly (readonly [string, Context])[] = [
	['plain', { kind: 'plain' }],
	...[false, true].flatMap(collapsed => [
		[`Query1 ${String(collapsed)}`, { kind: 'query', query: queryV1(), collapsed }],
		[`Query2 ${String(collapsed)}`, { kind: 'query', query: queryV2(), collapsed }],
		[`saved ${String(collapsed)}`, { kind: 'saved', collectionId: 'saved', collapsed }]
	] as const)
];
function repaired(photo: PhotoDocumentCurrentV1): PhotoDocumentCurrentV1 {
	const master = photo.versions[0]!;
	const develop = replaceImageDevelopRepairSpotsV1(master.develop, { schemaVersion: 1, spots: [{ id: 'proof-repair', mode: 'clone', enabled: false,
		target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: .2, opacity: .5 }] });
	return normalizePhotoDocumentCurrentV1({ ...photo, schemaVersion: 3, versions: [{ ...master,
		workspace: { schemaVersion: 3, kind: 'photo-develop-workspace', cursor: 0, snapshots: [], entries: [
			{ label: 'Original', createdAt: '2026-10-01T00:00:00.000Z', develop: master.develop },
			{ label: 'Retained repaired redo', createdAt: '2026-10-01T00:00:00.000Z', develop }
		] } }] });
}

for (const [name, context] of contexts) test(`Lightscaper native culling ${name} authenticates retained repaired Current3 beyond a valid scalar summary`, async () => {
	await fixture(async database => {
		const f = seed(database, 2, { patch: repaired });
		assert.equal((await read(database, CATALOG, context, { photoId: photoId(0) }))?.rows[0]?.id, photoId(0));
		const valid = JSON.stringify(f.photos[0]), damaged = valid.replace('"radius":0.1', '"radius":-1');
		assert.notEqual(damaged, valid, 'The actual persisted retained repair must be corrupted.');
		database.prepare('UPDATE native_photos SET document=? WHERE photo_key=?').run(damaged, key(0));
		await assert.rejects(read(database, CATALOG, context, { photoId: photoId(0) }));
		assert.equal(database.isTransaction, false);
	});
});

for (const [name, context] of contexts.filter(([, context]) => context.kind !== 'plain')) test(`Lightscaper native culling ${name} refuses same-revision non-sort query projection corruption`, async () => {
	await fixture(async database => {
		const f = seed(database, 2), legacy = context.kind === 'query' && !('schemaVersion' in context.query);
		const row = legacy ? f.rowsV1[0]! : f.rowsV2[0]!;
		database.prepare(`UPDATE ${legacy ? 'native_photo_query_rows_v1' : 'native_photo_query_rows_v2'} SET row_json=? WHERE photo_key=?`)
			.run(JSON.stringify({ ...row, title: 'Forged same revision text' }), key(0));
		await assert.rejects(read(database, CATALOG, context, { photoId: photoId(0) }), TypeError);
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native culling binds full Photo to scalar summary even when both keys and revisions still agree', async () => {
	await fixture(async database => {
		const f = seed(database, 2), summary = photoSummary(f.photos[0]!);
		database.prepare('UPDATE native_photos SET summary=? WHERE photo_key=?').run(JSON.stringify({ ...summary, width: summary.width + 1 }), key(0));
		for (const [, context] of contexts) await assert.rejects(read(database, CATALOG, context, { photoId: photoId(0) }), TypeError);
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native culling cannot mistake a valid metadata row for its forged native scalar revision', async () => {
	await fixture(async database => {
		seed(database, 2);
		database.prepare('UPDATE native_photo_query_rows_v2 SET photo_revision=photo_revision+1 WHERE photo_key=?').run(key(0));
		await assert.rejects(read(database, CATALOG, { kind: 'query', query: queryV2(), collapsed: false }, { photoId: photoId(0) }), TypeError);
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native culling legacy point proof preserves genuine Row1 overflow refusal', async () => {
	await fixture(async database => {
		const f = seed(database, 2), overflow = overflowLegacyQueryPhotoCurrentV1(f.photos[0]!);
		replaceLegacyQuerySourceCurrentV1(database, overflow);
		for (const collapsed of [false, true]) await assert.rejects(read(database, CATALOG,
			{ kind: 'query', query: queryV1(), collapsed }, { photoId: photoId(0) }), RangeError);
		assert.equal(database.isTransaction, false);
	});
});

function observeOnlySelectedAggregate(database: DatabaseSync, selected: string) {
	const original = database.prepare; let delivered = 0;
	database.prepare = function (...parameters: Parameters<typeof original>) {
		const statement = original.apply(database, parameters), [sql] = parameters;
		if (!/\bFROM\s+native_photos\b/iu.test(sql) || !/\bdocument\b/iu.test(sql)) return statement;
		const inspect = (row: Record<string, SQLOutputValue> | undefined): void => {
			if (row === undefined) return; delivered++; assert.equal(row.photo_id, selected, 'Only the selected whole aggregate may be read.');
		};
		const get = statement.get, all = statement.all, iterate = statement.iterate;
		statement.get = function (...args: unknown[]) { const row = Reflect.apply(get, statement, args) as ReturnType<typeof get>; inspect(row); return row; };
		statement.all = function (...args: unknown[]) { const rows = Reflect.apply(all, statement, args) as ReturnType<typeof all>; rows.forEach(inspect); return rows; };
		statement.iterate = function (...args: unknown[]) {
			const iterator = Reflect.apply(iterate, statement, args) as ReturnType<typeof iterate>, next = iterator.next;
			iterator.next = function () { const result = Reflect.apply(next, iterator, []) as ReturnType<typeof next>; if (!result.done) inspect(result.value); return result; };
			return iterator;
		};
		return statement;
	};
	return { restore() { database.prepare = original; }, get delivered() { return delivered; } };
}

test('Lightscaper native culling all seven contexts read only the selected aggregate and need no Original body files', async () => {
	await fixture(async database => {
		seed(database, 8);
		database.prepare('UPDATE native_photos SET document=? WHERE photo_id<>?').run('{invalid other whole Photo', photoId(0));
		const observation = observeOnlySelectedAggregate(database, photoId(0));
		try {
			for (const [, context] of contexts) {
				const page = await read(database, CATALOG, context, { photoId: photoId(0) });
				assert.equal(page?.rows[0]?.id, photoId(0)); assert.equal(page?.rows.length, 8);
			}
			assert.ok(observation.delivered >= 7);
		} finally { observation.restore(); }
	});
});

test('Lightscaper native culling refuses forged packets before any actual SQLite statement', async () => {
	await fixture(async database => {
		let prepared = 0; const original = database.prepare;
		database.prepare = function (...args: Parameters<typeof original>) { prepared++; return original.apply(database, args); };
		try {
			const packet = admit('catalog', { kind: 'plain' }, { photoId: 'photo' });
			await assert.rejects(readAdmitted(database, { ...packet }), TypeError); assert.equal(prepared, 0); assert.equal(database.isTransaction, false);
		} finally { database.prepare = original; }
	});
});
