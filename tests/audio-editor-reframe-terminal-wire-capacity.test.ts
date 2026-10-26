/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { localAssistanceGuidedOutputMaximumByteLength } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-output-capacity.ts';

const authority = { reviewAuthorityVersion: 1 as const, audioWave: null, editorialCandidateIds: null,
	highlightVideoSignals: null, media: { audio: null, video: null } };

test('Reframe reserves the existing terminal review budget while intermediate JSON keeps its own capacity', () => {
	assert.equal(localAssistanceGuidedOutputMaximumByteLength('reframe', 'plan-crops', 'reframe-path', authority), 8 * 1024 ** 2);
	assert.equal(localAssistanceGuidedOutputMaximumByteLength('reframe', 'track-subjects', 'tracked-subjects', authority), 64 * 1024 ** 2);
});

import { packAssistanceReframePathV1, encodeAssistanceReframePathWireV1, decodeAssistanceReframePathWireV1 } from '../src/common/editor/assistance/reframe-path-wire-v1.ts';
import { planOwnedCropsV1 } from '../src/common/editor/assistance/owned-video-workflow-transforms-v1.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { createAssistanceWorkflowOwnedVideoHighlightStageRuntime } from '../desktop/assistance-workflow-owned-video-highlight-stage-runtime.ts';
import { reviewLocalAssistanceGuidedResult } from '../src/common/editor/assistance/local-assistance-guided-result-review.ts';
import { workflowHarness, withDirectory } from './fixtures/desktop-assistance-workflow-owned-video-highlight-stage-runtime.ts';
import { readFile } from 'node:fs/promises';

test('packed Reframe tuples preserve every crop, sample tick, authority and complete track provenance', () => {
	const frames = [0, 15, 31, 48].map((sourceFrame, index) => ({ sourceFrame, presentationTick: String(index * 1501) }));
	const expected = { schemaVersion: 1, kind: 'reframe-path', authority: { width: 1920, height: 1080, timescale: 3000, frames },
		fallbackChain: ['subject', 'saliency', 'center'], path: { schemaVersion: 1, targetAspect: { width: 9, height: 16 }, keyframes:
			frames.map(({ sourceFrame }, index) => ({ sourceFrame, authority: index < 2 ? 'subject' : index === 2 ? 'saliency' : 'center',
				trackIds: index < 2 ? ['subject-1', 'subject-2'] : [], crop: { left: index / 100, right: 0.5 - index / 100, top: 0, bottom: 0 } })) } };
	const packed = packAssistanceReframePathV1(expected);
	assert.equal(packed.trackSets.length, 2);
	assert.deepEqual(decodeAssistanceReframePathWireV1(JSON.parse(JSON.stringify(packed)) as unknown), expected);
	const corrupted = structuredClone(packed); corrupted.frames[0]![3] = 9;
	assert.throws(() => decodeAssistanceReframePathWireV1(corrupted), /track set/iu);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(encodeAssistanceReframePathWireV1(expected))), expected,
		'small legacy results retain their existing JSON representation');
});

test('the original 60000-sample center Reframe publishes and reviews every sample below the unchanged terminal limit', async () => {
	const frames = Array.from({ length: 60_000 }, (_, index) => ({ sourceFrame: index * 15, presentationTick: String(index * 1500), subjects: [] }));
	const tracked = { schemaVersion: 1, width: 16, height: 16, timescale: 3000, frames };
	const saliency = { ...tracked, frames: frames.map(({ sourceFrame, presentationTick }) => ({ sourceFrame, presentationTick, saliency: null })) };
	const expected = planOwnedCropsV1({ 'tracked-subjects': tracked, 'saliency-map': saliency }, defaultAssistanceWorkflowSettingsV1('reframe') as Parameters<typeof planOwnedCropsV1>[1]);
	assert.ok(Buffer.byteLength(JSON.stringify(expected)) > 8 * 1024 ** 2);
	await withDirectory(async directory => {
		const harness = await workflowHarness(directory, 'reframe', { videoSourceEndFrame: 900_000, maximumOutputBytes: 8 * 1024 ** 2,
			bodies: { 'plan-crops:tracked-subjects': tracked, 'plan-crops:saliency-map': saliency } });
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({ custody: harness.custody });
		await handlers['plan-crops'](harness.execution('plan-crops'));
		const bytes = new Uint8Array(await readFile(harness.outputPath('plan-crops', 'reframe-path')));
		assert.ok(bytes.byteLength <= 8 * 1024 ** 2);
		const workflow = harness.request;
		const reviewed = await reviewLocalAssistanceGuidedResult({ workflow,
			result: { contractVersion: 1, jobId: workflow.jobId, workflowId: workflow.workflowId, stageIds: workflow.stageIds, outputs: workflow.outputs },
			readOutput: async () => new Blob([bytes], { type: 'application/json' }) });
		assert.deepEqual(reviewed.outputs[0]!.semantic, expected);
	});
});
