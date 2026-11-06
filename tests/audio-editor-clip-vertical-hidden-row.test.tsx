/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioTrackRowNavigation } from '../src/common/editor/ui/timeline/useAudioTrackRowNavigation.js';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Navigation = ReturnType<typeof useAudioTrackRowNavigation>;
async function withNavigation(index: number, focus: (index: number, clipId: string) => boolean | void,
	check: (navigation: Navigation) => void) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clips = ['first', 'middle', 'last'].map((id, position) => createAudioClip({ id, sourceId: source.id,
		timelineStartFrame: position * 4_800, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 }));
	const tracks = [...clips.map(clip => createAudioTrack({ id: `track-${clip.id}`, clipIds: [clip.id] })),
		createAudioTrack({ id: 'empty', clipIds: [] })];
	const project = createCurrentAudioEditorProject({ id: 'vertical-navigation', sampleRate: 48_000, sources: [source], clips, tracks });
	const track = project.tracks[index]; assert.ok(track);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const current: { navigation: Navigation | null } = { navigation: null };
	function Subject() {
		current.navigation = useAudioTrackRowNavigation({ controller: { actions: { timeline: { selectClip() {} } } },
			project, track, projectedClips: clips, clipLookup: new Map(clips.map(clip => [clip.id, clip])),
			sourceLookup: new Map([[source.id, source]]), trackWindowRef: { current: null }, trackIndex: index, trackCount: tracks.length,
			isFlatNavigation: false, trackBaseTabIndex: 0, sampleRate: 48_000, blocked: false, canonicalVideoTrim: false,
			run: (operation: () => unknown) => operation(), onFocusTimelineRuler: () => false, onFocusTrackContainer: () => false,
			onFocusTrackPanelControl: () => false, onFocusTrackClip: (next: number, _last: boolean, id: string) => focus(next, id),
			onFocusTrackRuler: () => false, onFocusSelectionToolbar: () => false });
		return null;
	}
	try { await act(async () => root.render(<Subject />)); assert.ok(current.navigation); check(current.navigation); }
	finally { await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act; }
}

for (const direction of [1, -1] as const) test(`vertical clip focus skips a rejected hidden row toward ${direction}`, async () => {
	const calls: string[] = [];
	const sourceIndex = direction === 1 ? 0 : 2, expected = direction === 1 ? 'last' : 'first';
	await withNavigation(sourceIndex, (index, id) => { calls.push(id); return index !== 1; }, navigation => {
		navigation.navigateClipVertical(direction === 1 ? 'first' : 'last', direction);
		assert.deepEqual(calls, ['middle', expected]);
	});
});

test('vertical clip focus retains wrap-around and empty-track skipping', async () => {
	const calls: string[] = [];
	await withNavigation(0, (_index, id) => { calls.push(id); return true; }, navigation => navigation.navigateClipVertical('first', -1));
	assert.deepEqual(calls, ['last']);
});

for (const legacy of [false, true]) test(`a ${legacy ? 'void legacy' : 'successful'} focus callback ends the scan`, async () => {
	const calls: string[] = [];
	await withNavigation(0, (_index, id) => { calls.push(id); return legacy ? undefined : true; }, navigation => navigation.navigateClipVertical('first', 1));
	assert.deepEqual(calls, ['middle']);
});

test('a scan with no reachable row stays bounded and never returns to the source clip', async () => {
	const calls: string[] = [];
	await withNavigation(0, (_index, id) => { calls.push(id); return false; }, navigation => navigation.navigateClipVertical('first', 1));
	assert.deepEqual(calls, ['middle', 'last']);
});
