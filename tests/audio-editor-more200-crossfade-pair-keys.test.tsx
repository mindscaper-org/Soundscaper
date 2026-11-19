/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CrossfadeOverlays } from '../src/common/editor/ui/timeline/CrossfadeOverlays.tsx';
import { createCrossfadeOverlays } from '../src/common/editor/ui/timeline/TrackOverlapOverlays.jsx';
import { projectClipsToViewport } from '../src/common/editor/design-system-adapters/timeline.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('real Split, history and Scape preserve two distinct colon-bearing crossfade pairs', async context => {
	const fixture = await createClipboardCustody(context);
	const { controller } = fixture;
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const clips = ['a:b', 'c', 'a', 'b:c'].map((id, index) => createAudioClip({ id,
		title: ['First outgoing', 'First incoming', 'Second outgoing', 'Second incoming'][index], sourceId: source.id,
		timelineStartFrame: [0, 48_000, 192_000, 240_000][index], durationFrames: 96_000, sourceDurationFrames: 96_000 }));
	const pcm = new Float32Array(96_000).fill(.25);
	await fixture.open(createSoundscaperProject({ id: 'crossfade-pair-keys', title: 'Crossfades', sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: clips.map(clip => clip.id) })] }), new Map([[source.id, [pcm]]]));
	const before = clipboardProject(controller.project);
	controller.actions.timeline.selectClip('a:b');
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const render = async (project: typeof before, firstId: string) => {
		const trackClips = project.clips.map(clip => {
			assert.ok(clip.kind === 'audio');
			assert.ok(typeof clip.timelineStartFrame === 'number' && typeof clip.durationFrames === 'number');
			return { ...clip, timelineStartFrame: clip.timelineStartFrame, durationFrames: clip.durationFrames };
		});
		const projection = projectClipsToViewport(trackClips, { viewportStartFrame: 0, viewportDurationFrames: 336_000, sampleRate: 48_000 });
		const overlays = createCrossfadeOverlays(projection.clips, projection.overscanStartFrame, 100, 48_000);
		assert.deepEqual(overlays.map(overlay => [overlay.outgoingClipId, overlay.incomingClipId]), [[firstId, 'c'], ['a', 'b:c']]);
		await act(async () => { root.render(<CrossfadeOverlays overlays={overlays}
			clipLookup={new Map(project.clips.map(clip => [clip.id, clip]))}
			selectedIds={new Set()} top={0} height={80} blocked={false} copy={ENGLISH_COPY}
			controller={controller} run={operation => operation()} onTabOut={() => undefined} />); });
		assert.equal(dom.container.querySelectorAll('[data-crossfade-handle]').length, 2);
	};
	try {
		await render(before, 'a:b');
		// The native playhead's five unmodified ArrowRight presses advance five samples.
		controller.actions.edit.splitAt(5, ['voice']);
		const after = clipboardProject(controller.project);
		assert.equal(after.clips.length, 5);
		const right = after.clips.find(clip => !before.clips.some(original => original.id === clip.id)); assert.ok(right);
		const left = after.clips.find(clip => clip.id === 'a:b'); assert.ok(left);
		assert.deepEqual([left.timelineStartFrame, left.durationFrames, left.sourceStartFrame, left.sourceDurationFrames], [0, 5, 0, 5]);
		assert.deepEqual([right.timelineStartFrame, right.durationFrames, right.sourceStartFrame, right.sourceDurationFrames], [5, 95_995, 5, 95_995]);
		for (const id of ['c', 'a', 'b:c']) assert.deepEqual(after.clips.find(clip => clip.id === id), before.clips.find(clip => clip.id === id));
		assert.deepEqual(after.sources, before.sources);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
		await render(after, right.id);
		controller.actions.edit.undo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await render(clipboardProject(controller.project), 'a:b');
		controller.actions.edit.redo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		await render(clipboardProject(controller.project), right.id);
		const reopened = await fixture.archive((_name, channels) => assertPcmChannelsEqual(channels, [pcm], 'original constant source'));
		assert.deepEqual(clipboardDocument(reopened), clipboardDocument(after));
		await render(reopened, right.id);
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
