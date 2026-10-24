/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ScapeImportTransaction, type ScapeImportStore } from '../src/common/editor/scape-import-transaction.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';

test('Scape staging admits many owned sources with linear identity work', async () => {
	let reads = 0;
	const discarded: StorageRecord[] = [];
	const store = { async discardSourceIfCurrent(source: StorageRecord) { discarded.push(source); return true; } } as unknown as ScapeImportStore;
	const transaction = new ScapeImportTransaction(store);
	for (let index = 0; index < 512; index++) transaction.trackProvisionalSource({
		get id() { reads++; return `source-${index}`; }, sourceToken: `token-${index}`, name: `source ${index}`,
	});
	assert.ok(reads <= 512 * 4, `source identity reads: ${reads}`);
	const primary = new Error('rollback');
	await assert.rejects(transaction.rollback(primary), error => error === primary);
	assert.equal(discarded.length, 512);
	assert.equal(discarded[0]?.id, 'source-511');
	assert.equal(discarded.at(-1)?.id, 'source-0');
});

test('Scape ownership deduplicates exact tokens, detaches records and retains newer versions', async () => {
	const discarded: StorageRecord[] = [];
	let media = 0;
	const store = { async discardSourceIfCurrent(source: StorageRecord) { discarded.push(source); return true; } } as unknown as ScapeImportStore;
	const transaction = new ScapeImportTransaction(store);
	const source = { id: 'a', sourceToken: 'old', name: 'first' };
	transaction.trackProvisionalSource(source);
	source.name = 'changed';
	transaction.trackProvisionalSource(source);
	transaction.trackProvisionalSource({ id: 'a', sourceToken: 'new', name: 'second' });
	transaction.trackProvisionalSource({ id: 'a\u0000old', sourceToken: 'new', name: 'separate' });
	const publication = { metadata: {}, async discardIfCurrent() { media++; return true; } };
	transaction.trackProvisionalMedia(publication);
	transaction.trackProvisionalMedia(publication);
	await assert.rejects(transaction.rollback(new Error('rollback')), /rollback/u);
	assert.deepEqual(discarded.map(value => [value.id, value.sourceToken, value.name]), [
		['a\u0000old', 'new', 'separate'], ['a', 'new', 'second'], ['a', 'old', 'first'],
	]);
	assert.equal(media, 1);
	transaction.complete();
	assert.throws(() => transaction.trackProvisionalSource(source), /already complete/u);
});
