/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { labelClipboardTarget } from '../src/common/editor/label-clipboard-selection.ts';

test('E03 label paste finds focused target without collecting every label track', context => {
	let reads = 0;
	const target = { id: 'target', type: 'label' };
	const tracks = [target, ...Array.from({ length: 200 }, (_, index) => ({ id: `later-${index}`, get type() { reads += 1; return 'label'; } }))];
	assert.equal(labelClipboardTarget({ tracks }, 'target'), target);
	assert.equal(reads, 0);
	context.diagnostic(`E03 later paste track reads: ${reads}`);
	assert.equal(labelClipboardTarget({ tracks: [{ id: 'audio', type: 'audio' }, target] }, 'missing'), target);
	assert.equal(labelClipboardTarget({ tracks: [target, { id: 'target', type: 'label' }] }, 'target'), target);
});
