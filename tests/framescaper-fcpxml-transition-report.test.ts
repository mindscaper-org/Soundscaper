/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportProjectFcpxml } from '../src/common/editor/controller/export/interchange-export-action.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { deliveryReportItems } from '../src/common/editor/ui/dialogs/editor-dialog-model.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';

test('I16: a menu-authored dissolve reaches the FCPXML delivery report before the save picker', async (context) => {
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'media/camera.mp4',
		mimeType: 'video/mp4', contentSha256: 'ab'.repeat(32), sampleFrameCount: 144_000,
		sourceFrameCount: 90, frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	const initial = createFramescaperProject(PROFILE, { id: 'programme', sampleRate: 48_000,
		sources: [source],
		clips: ['outgoing', 'incoming'].map((id, index) => ({ kind: 'video', id,
			sourceId: source.id, title: id, sequenceId: 'main-sequence', sequenceStartFrame: index * 30,
			sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 })),
		tracks: [{ id: 'picture', type: 'video', name: 'Picture', clipIds: ['outgoing', 'incoming'] }],
		sequences: [{ id: 'main-sequence', name: 'Main', rate: { num: 30, den: 1 }, trackIds: ['picture'] }],
	});
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({
		surface: 'video-transition-dissolve', project: initial, selectedClipId: 'outgoing', playheadSample: 0,
	});
	const pair = model.transitionPairs[0];
	assert.ok(pair);
	const prepared = await prepareFramescaperSelectedVisualAuthoringFinishing({
		surface: 'video-transition-dissolve', project: initial,
		store: createMemoryProjectStore(context, 'fcpxml-menu-dissolve'),
		request: { fence: model.fence, clipId: 'outgoing', operation: 'apply', pairId: pair.id, durationFrames: 15 },
	});
	const authored = applyFramescaperProjectCommand(PROFILE, initial, prepared.command);
	const track = authored.tracks.find(({ id }) => id === 'picture');
	assert.ok(track?.type === 'video');
	const transitions = track.videoTransitions;
	assert.ok(Array.isArray(transitions));
	assert.equal(transitions.length, 1);
	const transition: unknown = transitions[0];
	assert.ok(transition !== null && typeof transition === 'object' && 'id' in transition);
	assert.ok(typeof transition.id === 'string');
	const transitionId = transition.id;
	const state: { deliveryReport?: DeliveryReport } = {};
	let published = false;
	let saved = false;
	const result = await exportProjectFcpxml({ getProject: () => authored, state,
		publishDocumentSnapshot() { published = true; },
		fileService: { saveFile(request) {
			assert.equal(published, true);
			assert.equal(request.purpose, 'interchange');
			assert.ok(state.deliveryReport?.items.some(({ code, scope }) => code === 'fcpxml.transition-omitted'
				&& scope.id === transitionId));
			saved = true;
			return { cancelled: true };
		} },
	});
	assert.equal(saved, true);
	assert.ok(result);
	assert.equal(state.deliveryReport, result.report);
	assert.deepEqual(deliveryReportItems(state.deliveryReport), result.report.items);
});
