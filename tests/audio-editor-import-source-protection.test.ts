/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { claimProtectedSources } from '../src/common/editor/controller/import/internal/protected-source-claims.ts';

for (const releaseFirst of [0, 1]) test(`overlapping import owners retain shared sources with release order ${releaseFirst}`, () => {
	const sources = new Set<string>();
	const release = [claimProtectedSources(['video', 'audio', 'video'], sources), claimProtectedSources(['video'], sources)];
	release[releaseFirst]!(); release[releaseFirst]!();
	assert.equal(sources.has('video'), true, 'Only the releasing owner can retire its claim.');
	assert.equal(sources.has('audio'), releaseFirst === 1);
	release[1 - releaseFirst]!();
	assert.deepEqual([...sources], []);
});

test('import claims preserve protection borrowed from another subsystem', () => {
	const sources = new Set(['existing']);
	const first = claimProtectedSources(['existing', 'new'], sources);
	const second = claimProtectedSources(['existing', 'new'], sources);
	first(); second(); second();
	assert.deepEqual([...sources], ['existing']);
});
