/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { macroFileName } from '../src/common/editor/ui/inspector/inspector-helpers.ts';

test('text export stems retain distinct authored non-Latin names', () => {
	const names = ['ラジオ', '音楽', 'cafe\u0301'];
	assert.deepEqual(names.map(macroFileName), names);
	assert.equal(new Set(names.map(macroFileName)).size, names.length);
	assert.equal(macroFileName('  My noisy / macro  '), 'My-noisy-macro');
});
