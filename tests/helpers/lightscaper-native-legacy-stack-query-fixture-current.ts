/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { photoQueryRowKeyV1, type PhotoQueryRowV1 } from '../../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { photoQueryMatcherV1 } from '../../src/lightscaper/catalog/photo-query-matcher-v1.ts';
import type { PhotoCatalogQueryV1 } from '../../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoStackQueryPageRequestV1, PhotoStackQueryPageV1, PhotoStackQueryContinuationV1 } from '../../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import type { PhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { seedNativeLegacyQueryCurrentV1 } from './lightscaper-native-legacy-query-fixture-current.ts';

export type NativeLegacyStackReaderCurrentV1 = (database: DatabaseSync, catalogId: string, options?: PhotoStackQueryPageRequestV1) => PhotoStackQueryPageV1;
export function expectedNativeLegacyStackQueryCurrentV1(f: ReturnType<typeof seedNativeLegacyQueryCurrentV1>, query: PhotoCatalogQueryV1): string[] {
	const matches = photoQueryMatcherV1(f.root, query), rows = [...f.legacyRows].sort((a, b) => compare(a, b, query));
	const owners = new Map<string, Readonly<PhotoStackV1>>(), representatives = new Map<string, string>();
	for (const stack of f.stacks) {
		for (const id of stack.photoIds) owners.set(id, stack);
		const eligible = rows.filter(row => stack.photoIds.includes(row.photoId) && matches(row));
		const cover = eligible.find(row => row.photoId === stack.coverPhotoId), winner = cover ?? eligible[0];
		if (winner) representatives.set(stack.id, winner.photoId);
	}
	return rows.filter(row => matches(row) && (!owners.has(row.photoId) || representatives.get(owners.get(row.photoId)!.id) === row.photoId)).map(row => row.photoId);
}
function compare(left: PhotoQueryRowV1, right: PhotoQueryRowV1, query: PhotoCatalogQueryV1): number {
	const a = photoQueryRowKeyV1(left, query.sort.field), b = photoQueryRowKeyV1(right, query.sort.field);
	if (query.sort.field === 'capture-time' && left.captureBucket !== right.captureBucket) return left.captureBucket - right.captureBucket;
	for (let index = 0; index < a.length; index++) {
		if (a[index] === b[index]) continue;
		return (a[index]! < b[index]! ? -1 : 1) * (query.sort.direction === 'ascending' ? 1 : -1);
	}
	return 0;
}
export function collectNativeLegacyStackQueryCurrentV1(database: DatabaseSync, query: PhotoCatalogQueryV1, read: NativeLegacyStackReaderCurrentV1) {
	const ids: string[] = [], pages: PhotoStackQueryPageV1[] = []; let continuation: PhotoStackQueryContinuationV1 | null = null;
	do {
		const page = read(database, 'catalog', { query, continuation }); assert.ok(page.scanned >= 0 && page.scanned <= 64 && page.items.length <= 64);
		assert.ok(pages.length < 1200, 'Signed legacy progress must make bounded progress.'); assert.equal(database.isTransaction, false);
		if (page.continuation) assert.ok(Buffer.byteLength(JSON.stringify(page.continuation), 'utf8') <= 4096);
		pages.push(page); ids.push(...page.items.map(row => row.photoId)); continuation = page.continuation;
	} while (continuation);
	return { ids, pages };
}

export function observeNativeLegacyStackQueryReadsCurrentV1(database: DatabaseSync) {
	const original = database.prepare, delivered: string[] = []; let audited = 0, returned = 0;
	database.prepare = function (...parameters: Parameters<typeof original>) {
		const [sql] = parameters, statement = original.apply(database, parameters);
		const queryRows = /\bFROM\s+native_photo_query_rows_v1\b/iu.test(sql), stackKeys = /\bFROM\s+native_photo_stacks\b/iu.test(sql) && !/\bdocument\b/iu.test(sql);
		if (!queryRows && !stackKeys) return statement;
		const record = (row: Record<string, SQLOutputValue> | undefined): void => {
			if (row === undefined) return;
			if (queryRows && typeof row.photo_id === 'string') delivered.push(row.photo_id);
			else if (stackKeys && typeof row.stack_key === 'string') audited++;
		};
		type Argument = SQLInputValue | Record<string, SQLInputValue>;
		const get = statement.get.bind(statement) as (...args: Argument[]) => ReturnType<typeof statement.get>;
		const all = statement.all.bind(statement) as (...args: Argument[]) => ReturnType<typeof statement.all>;
		const iterate = statement.iterate.bind(statement) as (...args: Argument[]) => ReturnType<typeof statement.iterate>;
		statement.get = function (...args: Argument[]) { const row = get(...args); record(row); return row; };
		statement.all = function (...args: Argument[]) { const rows = all(...args); rows.forEach(record); return rows; };
		statement.iterate = function (...args: Argument[]) {
			const iterator = iterate(...args), next = iterator.next.bind(iterator), close = iterator.return?.bind(iterator);
			iterator.next = function () { const step = next(); if (step.done !== true) record(step.value); return step; };
			if (close) iterator.return = function () { returned++; return close(); };
			return iterator;
		};
		return statement;
	};
	return { delivered, get audited() { return audited; }, get returned() { return returned; }, restore() { database.prepare = original; } };
}
