/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioTrackRowPropReader, type AudioTrackRowMemoProps } from '../src/common/editor/ui/timeline/audio-track-row-props.ts';

function propsFor(clipIds: readonly string[], selectedClipIdSet: ReadonlySet<string>): AudioTrackRowMemoProps {
	const trackClips = clipIds.map((id, index) => ({ id, timelineStartFrame: index * 100, durationFrames: 100 }));
	return {
		controller: { getClipVisualData: () => null }, track: { id: 'row', type: 'audio' }, trackClips,
		clipLookup: new Map(trackClips.map(clip => [clip.id, clip])), renderViewportStartFrame: 0,
		viewportDurationFrames: 100, selectedClipIdSet,
	};
}

function selected(row: Readonly<Record<string, unknown>>): readonly string[] {
	return [...row.selectedClipIdSet as ReadonlySet<string>];
}

test('unchanged large selections narrow by local row membership on repeated notifications', (context) => {
	const selectedIds = new Set(Array.from({ length: 10_000 }, (_value, index) => `clip-${index}`));
	const props = propsFor(['clip-4', 'clip-8', 'clip-12'], selectedIds);
	const reader = createAudioTrackRowPropReader();
	const first = reader.read(props);
	let probes = 0;
	const has = Set.prototype.has;
	context.mock.method(Set.prototype, 'has', function (this: Set<unknown>, value: unknown): boolean {
		probes += 1;
		return has.call(this, value);
	});
	for (let notification = 0; notification < 100; notification += 1) {
		assert.equal(reader.read({ ...props, selectedTrackId: `other-${notification}` }).selectedClipIdSet,
			first.selectedClipIdSet);
	}
	assert.ok(probes < 2_000, `100 row notifications performed ${String(probes)} global membership probes`);
});

test('mutating a native global selection remains live and newly narrowed values retain source order', () => {
	const selection = new Set(Array.from({ length: 100 }, (_value, index) => `elsewhere-${index}`));
	selection.add('clip-c'); selection.add('clip-a');
	const props = propsFor(['clip-a', 'clip-b', 'clip-c'], selection);
	const reader = createAudioTrackRowPropReader();
	const first = reader.read(props);
	assert.deepEqual(selected(first), ['clip-c', 'clip-a']);
	selection.delete('clip-a'); selection.add('clip-b');
	const next = reader.read(props);
	assert.deepEqual(selected(next), ['clip-c', 'clip-b']);
	assert.notEqual(next.selectedClipIdSet, first.selectedClipIdSet);
	selection.delete('clip-c'); selection.delete('clip-b');
	assert.deepEqual(selected(reader.read(props)), []);
});

test('incoming drag membership joins local selection without duplicating clips already in the row', () => {
	const selection = new Set(Array.from({ length: 100 }, (_value, index) => `elsewhere-${index}`));
	selection.add('incoming'); selection.add('own');
	const props = propsFor(['own'], selection);
	const reader = createAudioTrackRowPropReader();
	const clipDragPreview = { previews: [
		{ trackId: 'row', clipId: 'own' }, { trackId: 'row', clipId: 'incoming' },
	] };
	const first = reader.read({ ...props, clipDragPreview, draggingClipIds: selection });
	assert.deepEqual(selected(first), ['incoming', 'own']);
	assert.deepEqual([...(first.draggingClipIds as ReadonlySet<string>)], ['incoming', 'own']);
	const next = reader.read({ ...props, clipDragPreview, draggingClipIds: selection });
	assert.equal(next.selectedClipIdSet, first.selectedClipIdSet);
	assert.deepEqual(selected(reader.read(props)), ['own']);
});

test('custom selection iterators preserve their live traversal rather than native membership', () => {
	const selection = new Set(Array.from({ length: 100 }, (_value, index) => `elsewhere-${index}`));
	let custom = ['own'];
	Object.defineProperty(selection, Symbol.iterator, { value: function* () { yield* custom; } });
	const props = propsFor(['own', 'incoming'], selection);
	const reader = createAudioTrackRowPropReader();
	assert.deepEqual(selected(reader.read(props)), ['own']);
	custom = ['incoming'];
	assert.deepEqual(selected(reader.read(props)), ['incoming']);
});


test('a proxied native selection preserves its bound live iterator', () => {
	const actual = new Set(Array.from({ length: 100 }, (_value, index) => `elsewhere-${index}`));
	actual.add('own');
	const selection = new Proxy(actual, {
		get(target, key) {
			if (key === Symbol.iterator) return target.values.bind(target);
			if (key === 'size') return target.size;
			return Reflect.get(target, key, target);
		},
	});
	const reader = createAudioTrackRowPropReader();
	const props = propsFor(['own', 'incoming'], selection);
	assert.deepEqual(selected(reader.read(props)), ['own']);
	actual.delete('own'); actual.add('incoming');
	assert.deepEqual(selected(reader.read(props)), ['incoming']);
});

test('native selection membership ignores an overridden has method just as native iteration does', () => {
	const selection = new Set(Array.from({ length: 100 }, (_value, index) => `elsewhere-${index}`));
	selection.add('own');
	selection.has = () => { throw new Error('Custom has must not replace native selection membership.'); };
	const reader = createAudioTrackRowPropReader();
	assert.deepEqual(selected(reader.read(propsFor(['own'], selection))), ['own']);
});
