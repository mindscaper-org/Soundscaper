/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioTrackRowPropReader, type AudioTrackRowMemoProps } from '../src/common/editor/ui/timeline/audio-track-row-props.ts';

void test('unchanged large-track viewport queries retain their result while visual publications stay fresh', context => {
	let visualReads = 0;
	let source = { id: 'source' };
	const clips = Array.from({ length: 10_000 }, (_, index) => ({ id: `clip-${index}`, timelineStartFrame: index * 1_000, durationFrames: 1_000 }));
	const props: AudioTrackRowMemoProps = {
		controller: { getClipVisualData() { visualReads++; return { source }; } },
		track: { id: 'row', type: 'audio' }, trackClips: clips, clipLookup: new Map(clips.map(clip => [clip.id, clip])),
		renderViewportStartFrame: 1_000_000, viewportDurationFrames: 500_000, selectedClipIdSet: new Set(),
	};
	const reader = createAudioTrackRowPropReader(), first = reader.read(props);
	let sorts = 0;
	const sortDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'sort');
	const nativeSort = Array.prototype.sort as (this: unknown[], compare?: (a: unknown, b: unknown) => number) => unknown[];
	Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true, value: function (this: unknown[], compare?: (a: unknown, b: unknown) => number) {
		sorts++;
		return nativeSort.call(this, compare);
	} });
	context.after(() => { if (sortDescriptor) Object.defineProperty(Array.prototype, 'sort', sortDescriptor); });
	visualReads = 0;
	for (let index = 0; index < 100; index++) reader.read({ ...props, selectedTrackId: `other-${index}` });
	assert.equal(visualReads, 150_000, 'fresh source/window publications are checked on every notification');
	assert.equal(sorts, 0, `100 unrelated publications sorted the same 1,500-clip query ${sorts} times`);
	source = { id: 'replacement' };
	assert.notEqual(reader.read(props).viewModelRevision, first.viewModelRevision, 'stable geometry does not hide replaced source data');
	reader.read({ ...props, renderViewportStartFrame: 2_000_000 }); assert.equal(sorts, 1, 'scrolling replaces the retained query');
	reader.read({ ...props, viewportDurationFrames: 250_000 }); assert.equal(sorts, 2, 'resizing replaces the retained query');
	reader.read({ ...props, trackClips: clips.slice() }); assert.equal(sorts, 4, 'a new immutable clip owner rebuilds its index and query');
});
