/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorSelectionActionGroup } from '../src/common/editor/controller/composition/selection-action-group.ts';

test('the selection action group routes calls and resolves its owner per call', () => {
	const calls: Array<readonly [string, ...unknown[]]> = [];
	let reads = 0;
	const method = (name: string) => (...args: unknown[]) => {
		calls.push([name, ...args]);
		return name;
	};
	const selectionView = {
		clipNavigation: { selectNextClip: method('selectNextClip') },
		selectTrack: method('selectTrack'),
		setSelection: method('setSelection'),
		setSnapSettings: method('setSnapSettings'),
		snapTimelineFrame: method('snapTimelineFrame'),
		selectAtZeroCrossings: method('selectAtZeroCrossings'),
	};
	const selection = createEditorSelectionActionGroup({
		getSelectionView: () => {
			reads += 1;
			return selectionView as never;
		},
	});

	assert.equal(reads, 0);
	assert.equal(selection.selectNextClip(), 'selectNextClip');
	assert.equal(selection.selectTrack('track'), 'selectTrack');
	assert.equal(selection.clearSelection(), 'setSelection');
	assert.equal(selection.setSnap({ mode: 'seconds' }), 'setSnapSettings');
	assert.equal(selection.snapFrame(12.4), 'snapTimelineFrame');
	assert.equal(selection.zeroCross(), 'selectAtZeroCrossings');
	assert.equal(reads, 6);
	assert.deepEqual(calls, [
		['selectNextClip'],
		['selectTrack', 'track'],
		['setSelection', 0, 0, { trackIds: [], frequencyRange: null }],
		['setSnapSettings', { mode: 'seconds' }],
		['snapTimelineFrame', 12.4],
		['selectAtZeroCrossings'],
	]);
});

test('selection owner failures stay synchronous and occur only on invocation', () => {
	let reads = 0;
	const selection = createEditorSelectionActionGroup({
		getSelectionView: () => {
			reads += 1;
			throw new Error('selection unavailable');
		},
	});

	assert.equal(reads, 0);
	assert.throws(() => selection.selectAll(), /selection unavailable/u);
	assert.equal(reads, 1);
});
