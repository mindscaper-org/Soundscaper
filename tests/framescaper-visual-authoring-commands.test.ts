/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareFramescaperSelectedVisualAuthoringFinishing as prepare,
} from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import {
	createFramescaperSelectedVisualAuthoringFenceFinishing as createFence,
} from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';

type Data = Record<string, unknown>;

function project(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 3,
		sampleRate: 48_000,
		selection: { clipIds: ['clip-1'] },
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', trackIds: ['video-track'], rate: { num: 30, den: 1 } }],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['clip-1'] }],
		clips: [{
			id: 'clip-1', kind: 'video', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10,
		}],
		videoVisualPresets: [], videoFinishingPresets: [], videoFreezeFallbacks: [],
		videoAdjustmentLayers: [], videoVisualPresentations: [], videoMaskMattes: [],
		videoTransitionsByTrackId: {},
		...overrides,
	};
}

function fence(source: Data = project()): Data {
	return createFramescaperFence(source);
}

function createFramescaperFence(source: Data): Data {
	return createFence({
		project: source, selectedClipId: 'clip-1', playheadSample: 0,
	}) as unknown as Data;
}

function store(): never {
	return { loadSource: async () => null } as unknown as never;
}

function author(surface: string, request: unknown, source: Data = project()): Promise<unknown> {
	return prepare({ surface: surface as never, project: source, store: store(), request } as never);
}

test('the fence gate runs before any surface-specific work', async () => {
	const stale = { ...fence(), projectRevision: 9 };

	await assert.rejects(
		() => author('video-mask-matte', { fence: stale, clipId: 'clip-1', operation: 'apply' }),
		/project is stale\. Reopen the dialog/u,
	);
});

test('a fence that never covered the authored clip is refused', async () => {
	await assert.rejects(
		() => author('video-mask-matte', { fence: fence(), clipId: 'clip-2', operation: 'apply' }),
		/stale selection\. Reopen the dialog/u,
	);
});

test('a selection that changed under the dialog is refused', async () => {
	await assert.rejects(
		() => author(
			'video-mask-matte',
			{ fence: fence(), clipId: 'clip-1', operation: 'apply' },
			project({ selection: { clipIds: [] } }),
		),
		/selection changed\. Reopen the dialog/u,
	);
});

test('a dissolve naming a pair the project no longer offers is refused', async () => {
	await assert.rejects(
		() => author('video-transition-dissolve', {
			fence: fence(), clipId: 'clip-1', operation: 'apply',
			pairId: 'pair-that-went-away', durationFrames: 2,
		}),
		/dissolve pair is stale\. Reopen the dialog/u,
	);
});
