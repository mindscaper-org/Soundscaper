/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotBootstrapCopyFields } from
	'../src/common/editor/ui/audio-editor-bootstrap-copy-snapshot.ts';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';

test('bootstrap copy preserves the registered English catalog', () => {
	const fields = new Set(Object.keys(EDITOR_ENGLISH_COPY));
	const copy = snapshotBootstrapCopyFields(EDITOR_ENGLISH_COPY, 'bundled copy', 'own data property', fields);
	assert.deepEqual(Object.entries(copy), Object.entries(EDITOR_ENGLISH_COPY));
});

test('bootstrap retains authentic copy origin but refuses foreign or forged symbol fields without reading accessors', () => {
	const fields = new Set(Object.keys(EDITOR_ENGLISH_COPY));
	const snapshot = (copy: Readonly<Record<string, unknown>>) => snapshotBootstrapCopyFields(copy, 'copy', 'own data property', fields);
	const origin = Object.getOwnPropertySymbols(EDITOR_ENGLISH_COPY)[0];
	assert.ok(origin);
	assert.equal(Object.getOwnPropertySymbols(snapshot({ ...EDITOR_ENGLISH_COPY }))[0], origin);
	assert.throws(() => snapshot({ ...EDITOR_ENGLISH_COPY, [Symbol('foreign')]: {} }), /inventory/u);
	assert.throws(() => snapshot({ ...EDITOR_ENGLISH_COPY, [origin]: {} }), /inventory/u);
	let reads = 0;
	const accessor = Object.defineProperty({ ...EDITOR_ENGLISH_COPY }, origin, { enumerable: true, get() { reads += 1; return {}; } });
	assert.throws(() => snapshot(accessor), /inventory/u);
	assert.equal(reads, 0);
});
