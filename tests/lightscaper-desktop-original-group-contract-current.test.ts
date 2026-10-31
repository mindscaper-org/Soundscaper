/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readDesktopPhotoOriginalGroupTicketCurrentV1 as read, readDesktopPhotoOriginalGroupTicketIdCurrentV1 as readId } from '../src/lightscaper/desktop-photo-original-group-contract-current-v1.ts';
import { originalStageRequestCurrentV1 } from './helpers/lightscaper-desktop-original-stage-fixture-current.ts';

test('Lightscaper group wire binds a closed receipt to every ordered complete Original and returns detached inert data', () => {
	const first = originalStageRequestCurrentV1(), second = { ...first, photoId: 'alias', original: { ...first.original, id: 'alias-source', name: 'Alias' } };
	const value = { id: 'a'.repeat(64), originals: [structuredClone(first.original), structuredClone(second.original)] };
	const ticket = read(value, [first, second]); value.originals.reverse(); assert.equal(Reflect.set(value.originals[0]!, 'name', 'late'), true);
	assert.equal(ticket.id, 'a'.repeat(64)); assert.deepEqual(ticket.originals, [first.original, second.original]); assert.equal(Object.isFrozen(ticket.originals), true);
});

test('Lightscaper group wire refuses malformed, sparse, reordered, changed and augmented Original vectors', () => {
	const first = originalStageRequestCurrentV1(), second = { ...first, photoId: 'alias', original: { ...first.original, id: 'alias-source' } }, id = 'a'.repeat(64);
	for (const value of [{ id, originals: [second.original, first.original] }, { id, originals: [first.original] }, { id, originals: new Array(2) },
		{ id, originals: [first.original, { ...second.original, storageKey: 'other' }] }, { id, originals: [first.original, second.original], path: '/private/path' }]) {
		assert.throws(() => read(value, [first, second]));
	}
});

test('Lightscaper group cleanup ID capture never consults untrusted Original fields or getters', () => {
	let reads = 0; const value = Object.defineProperty({ id: 'b'.repeat(64) }, 'originals', { enumerable: true, get() { reads++; throw Error('No authority reflection for cleanup.'); } });
	assert.equal(readId(value), 'b'.repeat(64)); assert.equal(reads, 0);
	for (const id of ['B'.repeat(64), 'a'.repeat(63), '/private']) assert.throws(() => readId({ id }));
});
