/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE } from '../src/common/editor/project-bin-dnd.js';
import { useTimelineProjectBinDnd } from '../src/common/editor/ui/timeline/useTimelineProjectBinDnd.js';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProjectBinVisualActions } from '../src/framescaper/editor-project-bin-visual-actions.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

async function dropImage(context: TestContext, trackId: string | null, locked = false, timelineStartFrame = 48_000) {
	const dom = installReactTestDom();
	context.after(() => dom.restore());
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const savedAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = ['addEventListener', 'removeEventListener'] as const;
	const former = listeners.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	for (const key of listeners) Object.defineProperty(globalThis, key, { configurable: true, value: window[key].bind(window) });
	const { project: initial, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	let project = initial;
	let minted = 0;
	const actions = createFramescaperProjectBinVisualActions({
		get project() { return project; }, getSnapshot: () => ({}), getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		selectClips: () => undefined, actions: { projectBin: {}, edit: { commit(command) {
			project = applyFramescaperProjectCommand(PROFILE, project, command);
		} } },
	}, prefix => `${prefix}-drag-${String(++minted)}`);
	assert.deepEqual(actions.moveFromTimeline(clip.id), [clip.id]);
	if (trackId === 'secondary-track') {
		const binClip = project.projectBin.clips.find(item => item.id === clip.id);
		assert.ok(binClip);
		const inBin = { scope: 'project-bin' };
		project = applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [
			{ type: 'sequence/create', sequence: { ...project.sequences[0], id: 'secondary', name: 'Secondary',
				rate: { num: 1, den: 1 }, trackIds: [], trackNodes: [] } },
			{ type: 'track/add', sequenceId: 'secondary', track: { id: trackId, type: 'video', clipIds: [] } },
			{ type: 'image-clip/set', clipId: clip.id, expectedClip: binClip, expectedPlacement: inBin,
				clip: { ...binClip, sequenceFrameCount: 1 }, placement: inBin },
		] });
	}
	if (locked) project = applyFramescaperProjectCommand(PROFILE, project, {
		type: 'track/update', trackId, changes: { locked: true },
	});
	const start = project;
	const root = createRoot(dom.container as unknown as Element);
	let handlers: ReturnType<typeof useTimelineProjectBinDnd> | null = null;
	type DropPreview = Readonly<{ createTrack?: boolean; trackId?: string; timelineStartFrame?: number;
		clip?: Readonly<{ durationFrames?: number }> }>;
	let preview: DropPreview | null = null;
	const view = createEditorProjectRuntimeSelection(PROFILE).projectForCommandConsumers(project);
	function Harness() {
		handlers = useTimelineProjectBinDnd({
			controller: { actions: { projectBin: actions } }, mutationsBlocked: false,
			state: { setDraggingClipIds() {}, setProjectBinDragPreview(change: unknown) {
				preview = typeof change === 'function' ? change(preview) as typeof preview : change as typeof preview;
			} },
			model: { project: view }, hitTesting: {
				clearProjectBinDragState() {}, timelineDropTargetAt: () => ({ trackId, createTrack: trackId === null, timelineStartFrame }),
			},
			menuActions: { run: (operation: () => unknown) => operation() },
		} as never);
		return null;
	}
	try {
		await act(async () => root.render(<Harness />));
		assert.ok(handlers);
		const event = {
			dataTransfer: { types: [AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE], files: [], dropEffect: 'none',
				getData: () => JSON.stringify({ projectId: project.id, clipId: clip.id }) }, preventDefault() {},
		};
		await act(async () => handlers!.onTimelineDragOver(event));
		await act(async () => handlers!.onTimelineDrop(event));
		return { start, project, preview: preview as DropPreview | null, dropEffect: event.dataTransfer.dropEffect };
	} finally {
		await act(async () => root.unmount());
		for (const [index, key] of listeners.entries()) {
			const descriptor = former[index];
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
		actGlobal.IS_REACT_ACT_ENVIRONMENT = savedAct;
	}
}

test('dragging a Project Bin image over an existing picture track previews that track', async context => {
	const result = await dropImage(context, 'video-track');
	assert.equal(result.preview?.createTrack, false);
	assert.equal(result.preview?.trackId, 'video-track');
	assert.equal(result.project.tracks.length, result.start.tracks.length);
});

test('dropping a Bin image into the new-track zone creates the previewed picture track', async context => {
	const result = await dropImage(context, null);
	assert.equal(result.preview?.createTrack, true);
	assert.equal(result.project.tracks.length, result.start.tracks.length + 1);
	const image = result.project.clips.find(item => item.kind === 'image');
	assert.ok(image);
	assert.deepEqual(result.project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(image.id))?.id,
		'image-track-drag-1');
});

test('dropping a Bin image on a locked picture track never places it on a different track', async context => {
	const result = await dropImage(context, 'video-track', true);
	assert.equal(result.dropEffect, 'none');
	assert.equal(result.project, result.start);
});

test('the Project Bin image ghost lands on the same frame boundary as the committed drop', async context => {
	const result = await dropImage(context, 'video-track', false, 50_000);
	const image = result.project.clips.find(item => item.kind === 'image');
	assert.equal(image?.sequenceStartFrame, 10);
	assert.equal(result.preview?.timelineStartFrame, 48_000);
});

test('dragging a short image from the Bin onto a slower sequence previews the complete destination frame', async context => {
	const result = await dropImage(context, 'secondary-track');
	const image = result.project.clips.find(item => item.kind === 'image');
	assert.equal(image?.sequenceId, 'secondary');
	assert.equal(image?.sequenceFrameCount, 1);
	assert.equal(result.preview?.clip?.durationFrames, 48_000);
});
