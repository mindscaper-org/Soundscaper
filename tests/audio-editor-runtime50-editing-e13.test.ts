/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { punchTransitionCutRange } from '../src/common/editor/commands/punch-transition-range.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

test('E13 punch transition admission avoids overlap arrays and preserves ambiguous boundaries', context => {
	const clips = [{ timelineStartFrame: 0, durationFrames: 150 }, { timelineStartFrame: 180, durationFrames: 120 }, ...Array.from({ length: 100 }, (_, index) => ({ timelineStartFrame: 400 + index * 100, durationFrames: 10 }))];
	let range: ReturnType<typeof punchTransitionCutRange> | undefined;
	const count = visits('filter', () => { range = punchTransitionCutRange({ startFrame: 100, endFrame: 200 }, clips, { transitionInFrames: 10, transitionOutFrames: 10 }); });
	assert.deepEqual(range, { startFrame: 110, endFrame: 190, durationFrames: 80 });
	assert.equal(count, 0);
	context.diagnostic(`E13 punch filter visits: ${count}`);
	assert.deepEqual(punchTransitionCutRange({ startFrame: 100, endFrame: 200 }, [...clips, { timelineStartFrame: 90, durationFrames: 20 }], { transitionInFrames: 10 }), { startFrame: 100, endFrame: 200, durationFrames: 100 });
	assert.throws(() => punchTransitionCutRange({ startFrame: 100, endFrame: 200 }, clips, { transitionInFrames: -1 }), /nonnegative/);
});
