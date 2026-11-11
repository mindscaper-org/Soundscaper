/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { toDesignRecordingPreview } from '../src/common/editor/ui/timeline/preview.ts';
import { TrackNew } from '../vendor/audacity-design-system/components/src/Track/TrackNew.tsx';
import { projectClipsToViewport } from '../src/common/editor/design-system-adapters/timeline.ts';
import { selectionControllerCustody, selectionWav, selectionClipVisual } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';

function accessibleName(clip: { id: string; name: string; start: number; duration: number }): string {
	const markup = renderToStaticMarkup(<TrackNew clips={[clip]} trackIndex={0} width={800} />);
	const match = /data-clip-id="[^"]+"[^>]*aria-label="([^"]+)"/u.exec(markup);
	assert.ok(match, 'the timeline clip has an accessible name');
	return match[1];
}

for (const startFrame of [0, 480_000]) {
	test(`clip accessible timing keeps the authored interval at frame ${startFrame}`, () => {
		const clip = { id: 'clip', sourceId: 'source', timelineStartFrame: startFrame,
			durationFrames: 9600, sourceStartFrame: 0, sourceDurationFrames: 9600,
			waveformStartFrame: 0, waveformEndFrame: 9600 };
		const model = createTimelineClipViewModel({
			controller: { getClipVisualData: () => null }, sourceLookup: new Map([['source', { name: 'Recording', sampleRate: 48_000 }]]),
			clip, geometry: { overscanStartFrame: startFrame, pixelsPerSecond: 120, sampleRate: 48_000 },
			selection: { selectedClipIds: null }, copy: { clip: 'Clip' }, rendering: {},
		});
		assert.equal(model.start, 0, 'the painted interval remains relative to the viewport');
		assert.equal(model.duration, 0.4, 'minimum visual width remains available for editing');
		assert.equal(accessibleName(model), `Recording clip, starts at ${startFrame ? '10 seconds' : '0 seconds'}, 0.2 seconds long`);
	});
}

test('recording preview announces elapsed audio without inflating its editing hit area', () => {
	const model = toDesignRecordingPreview({ id: 'preview', timelineStartFrame: 96_000,
		durationFrames: 4800, waveformStartFrame: 0, waveformEndFrame: 4800 }, null, 96_000, 120, 48_000,
	{ recordingLabel: 'Recording' });
	assert.equal(model.start, 0);
	assert.equal(model.duration, 0.4);
	assert.equal(accessibleName(model), 'Recording clip, starts at 2 seconds, 0.1 seconds long');
});

test('standalone design-system clips retain their ordinary seconds contract', () => {
	assert.equal(accessibleName({ id: 'standalone', name: 'Clip', start: 2, duration: 1 }),
		'Clip clip, starts at 2 seconds, 1 second long');
});

test('actual imported Split geometry reaches accessible Track labels, history and fresh Scape PCM', async context => {
	const f = await selectionControllerCustody(context, selectionWav('browser-tone-a.wav', 38_400, 2, 48_000, 330));
	try {
		const before = clipboardProject(f.controller.project), original = before.clips[0]; assert.ok(original);
		const owner = before.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(original.id)); assert.ok(owner);
		f.controller.actions.timeline.selectClip(original.id);
		const entries = f.controller.getSnapshot().history.undoEntries.length;
		f.controller.actions.edit.splitAt(9600, [owner.id]);
		const after = clipboardProject(f.controller.project); assert.equal(after.clips.length, 2);
		const right = after.clips.find(clip => clip.id !== original.id), left = after.clips.find(clip => clip.id === original.id);
		assert.ok(left); assert.ok(right);
		assert.deepEqual([left.timelineStartFrame, left.durationFrames, left.sourceStartFrame, left.sourceDurationFrames], [0, 9600, 0, 9600]);
		assert.deepEqual([right.timelineStartFrame, right.durationFrames, right.sourceStartFrame, right.sourceDurationFrames], [9600, 28_800, 9600, 28_800]);
		assert.deepEqual(after.sources, before.sources); assert.equal(f.controller.getSnapshot().history.undoEntries.length, entries + 1);
		const names = (value: unknown) => {
			const project = clipboardProject(value);
			const clips = project.clips.map(clip => {
				assert.ok(clip.kind === 'audio' && typeof clip.sourceId === 'string' && typeof clip.sourceStartFrame === 'number'
					&& typeof clip.timelineStartFrame === 'number' && typeof clip.durationFrames === 'number');
				return { ...clip, sourceId: clip.sourceId, sourceStartFrame: clip.sourceStartFrame, timelineStartFrame: clip.timelineStartFrame, durationFrames: clip.durationFrames };
			});
			const projection = projectClipsToViewport(clips, { viewportStartFrame: 0, viewportDurationFrames: 38_400, sampleRate: 48_000 });
			return projection.clips.map(clip => accessibleName(createTimelineClipViewModel({
				controller: { getClipVisualData: id => selectionClipVisual(f.controller, id) },
				sourceLookup: new Map(project.sources.map(source => [source.id, source])), clip,
				geometry: { overscanStartFrame: projection.overscanStartFrame, pixelsPerSecond: 120, sampleRate: 48_000 },
				selection: { selectedClipIds: null }, copy: { clip: 'Clip' }, rendering: {},
			})));
		};
		const expected = ['browser-tone-a.wav clip, starts at 0 seconds, 0.2 seconds long', 'browser-tone-a.wav clip, starts at 0.2 seconds, 0.6 seconds long'];
		assert.deepEqual(names(after), expected);
		f.controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(f.controller.project)), clipboardDocument(before));
		f.controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(f.controller.project)), clipboardDocument(after));
		const reopened = await f.archive(); assert.deepEqual(names(reopened), expected);
	} finally { await f.dispose(); }
});
