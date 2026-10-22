/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAudacityItemNavigationAction } from '../src/common/editor/audacity-shortcut-actions/item-navigation.ts';
import { collectClipTransformIds } from '../src/common/editor/commands/clip-basic-runtime.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const ACTION = Object.freeze({
	left: 'track-view-item-move-left',
	right: 'track-view-item-move-right',
	up: 'track-view-item-move-up',
	down: 'track-view-item-move-down',
});

test('clip item commands preserve the four dispatched movement directions', () => {
	const { controller, calls } = fixture();

	for (const action of Object.values(ACTION)) applyAudacityItemNavigationAction(action, controller);

	assert.deepEqual(calls.moves, [
		['clip-a', 'audio-a', 100],
		['clip-a', 'audio-a', 300],
		['clip-a', 'audio-up', 200, { preserveTime: true }],
		['clip-a', 'audio-down', 200, { preserveTime: true }],
	]);
	assert.deepEqual(calls.trims, []);
	assert.deepEqual(calls.selections, []);
});

test('clip commands delegate through the active member of a durable multi-selection', () => {
	const { controller, project, calls } = fixture();
	project.selection.clipIds = ['clip-a', 'clip-b'];

	applyAudacityItemNavigationAction(ACTION.right, controller);

	assert.deepEqual(calls.moves, [['clip-a', 'audio-a', 300]]);
	assert.deepEqual(project.selection.clipIds, ['clip-a', 'clip-b']);
	assert.deepEqual(collectClipTransformIds(project, 'clip-a'), ['clip-a', 'clip-b']);
});

test('an explicitly focused track owns vertical movement and makes horizontal movement a no-op', () => {
	const { controller, state, project, calls } = fixture();
	state.selectedClipId = null;
	state.selectedTrackId = 'audio-a';
	project.selection.clipIds = ['clip-a', 'clip-b'];

	assert.equal(applyAudacityItemNavigationAction(ACTION.left, controller), null);
	applyAudacityItemNavigationAction(ACTION.up, controller);
	applyAudacityItemNavigationAction(ACTION.down, controller);

	assert.deepEqual(calls.moves, []);
	assert.deepEqual(calls.trackMoves, [['up', 'audio-a'], ['down', 'audio-a']]);
});

test('a focused label takes item priority and moves atomically between label tracks', () => {
	const { controller, state, calls } = fixture();
	state.selectedClipId = null;
	state.selectedTrackId = 'labels-a';
	const row = { dataset: { trackId: 'labels-a' } };
	const marker = {
		dataset: { labelId: 'label-a' },
		closest: (selector: string) => selector === '[data-label-id]' ? marker : row,
	};
	const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: marker } });
	try {
		applyAudacityItemNavigationAction(ACTION.left, controller);
		applyAudacityItemNavigationAction(ACTION.down, controller);
	} finally {
		if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
		else Reflect.deleteProperty(globalThis, 'document');
	}

	assert.deepEqual(calls.labelUpdates, [
		['labels-a', 'label-a', { startFrame: 200, endFrame: 500 }],
	]);
	assert.deepEqual(calls.commits, [{
		command: {
			type: 'batch',
			commands: [
				{ type: 'label/remove', trackId: 'labels-a', labelId: 'label-a' },
				{
					type: 'label/add', trackId: 'labels-b',
					label: { id: 'label-a', title: 'Marker', startFrame: 300, endFrame: 600 },
				},
			],
		},
		selection: { selectTrackId: 'labels-b' },
	}]);
});

test('a focused label marker yields its Shift+Arrow boundary chord to item navigation', () => {
	const dom = installReactTestDom();
	try {
		const row = document.createElement('div');
		row.setAttribute('data-label-track', '');
		row.setAttribute('data-track-id', 'labels-a');
		const marker = document.createElement('div');
		marker.setAttribute('data-label-id', 'label-a');
		marker.setAttribute('role', 'group');
		row.appendChild(marker);
		dom.container.appendChild(row as never);
		let calls = 0;
		let prevented = 0;
		handleWorkspaceKeyboard({
			altKey: false, code: 'ArrowLeft', ctrlKey: false, defaultPrevented: false,
			key: 'ArrowLeft', metaKey: false, repeat: false, shiftKey: true, target: marker,
			preventDefault: () => { prevented += 1; },
		}, { preferences: { shortcuts: { 'track-view-item-extend-left': ['Shift+Left'] } } }, (handler) => handler(), {
			menus: [{ id: 'track-view-item-extend-left', onClick: () => { calls += 1; } }],
		});
		assert.deepEqual({ calls, prevented }, { calls: 1, prevented: 1 });
	} finally {
		dom.restore();
	}
});

interface MutableState {
	project: MutableProject;
	selectedClipId: string | null;
	selectedTrackId: string | null;
	transportState: string;
}

type MutableProject = ControllerProject & {
	selection: { startFrame: number; endFrame: number; trackIds: string[]; clipIds: string[] };
};

function fixture() {
	const project = {
		schemaVersion: 1, id: 'project', title: 'Project', sampleRate: 1_000,
		tracks: [
			{ id: 'audio-up', name: 'Audio up', type: 'audio', clipIds: [] },
			{
				id: 'labels-a', name: 'Labels A', type: 'label', clipIds: [],
				labels: [{ id: 'label-a', title: 'Marker', startFrame: 300, endFrame: 600 }],
			},
			{ id: 'audio-a', name: 'Audio A', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'video', name: 'Video', type: 'video', clipIds: [] },
			{ id: 'audio-down', name: 'Audio down', type: 'audio', clipIds: ['clip-b'] },
			{ id: 'labels-b', name: 'Labels B', type: 'label', clipIds: [], labels: [] },
		],
		clips: [
			{
				id: 'clip-a', kind: 'audio', sourceId: 'source', title: 'A',
				timelineStartFrame: 200, durationFrames: 200,
				sourceStartFrame: 200, sourceDurationFrames: 200,
			},
			{
				id: 'clip-b', kind: 'audio', sourceId: 'source', title: 'B',
				timelineStartFrame: 500, durationFrames: 200,
				sourceStartFrame: 200, sourceDurationFrames: 200,
			},
		],
		sources: [{
			id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
			frameCount: 2_000, channelCount: 1, sampleRate: 1_000, originalSampleRate: 1_000,
		}],
		selection: { startFrame: 50, endFrame: 150, trackIds: [], clipIds: ['clip-a'] },
		mixer: { groups: [], sends: [], routes: {} },
	} as MutableProject;
	const state: MutableState = {
		project, selectedClipId: 'clip-a', selectedTrackId: 'audio-a', transportState: 'stopped',
	};
	const calls = {
		moves: [] as unknown[][],
		trims: [] as unknown[][],
		trackMoves: [] as unknown[][],
		labelUpdates: [] as unknown[][],
		commits: [] as unknown[],
		selections: [] as unknown[][],
		seeks: [] as number[],
	};
	const controller = {
		getSnapshot: () => ({
			project: state.project,
			selectedClipId: state.selectedClipId,
			selectedTrackId: state.selectedTrackId,
			timeline: { pixelsPerSecond: 100 },
		}),
		getTelemetrySnapshot: () => ({ positionFrame: 1_000, transportState: state.transportState }),
		actions: {
			clip: {
				move: (...args: unknown[]) => calls.moves.push(args),
				trim: (...args: unknown[]) => calls.trims.push(args),
			},
			edit: {
				commit: (command: AudioEditorCommand, selection?: unknown) => calls.commits.push({ command, selection }),
			},
			labels: {
				update: (...args: unknown[]) => calls.labelUpdates.push(args),
			},
			timeline: {
				setSelection: (startFrame: number, endFrame: number) => calls.selections.push([startFrame, endFrame]),
			},
			track: {
				moveUp: (trackId: string) => calls.trackMoves.push(['up', trackId]),
				moveDown: (trackId: string) => calls.trackMoves.push(['down', trackId]),
			},
			transport: { seek: (frame: number) => calls.seeks.push(frame) },
		},
	};
	return { controller, project, state, calls };
}
