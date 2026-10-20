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
