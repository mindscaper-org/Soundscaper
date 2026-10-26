/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistanceAcceptedReframeDerivativeV1 } from '../src/common/editor/assistance/reframe-derivative-v1.ts';
import { prepareOwnedHighlightCropKeyframesV1 } from '../src/common/editor/assistance/owned-highlight-crop-evidence-v1.ts';
import { interpolateAssistanceReframeCropV1 } from '../src/common/editor/assistance/reframe-planner-v1.ts';
import { reframeWorkflow, reframeResult } from './helpers/assistance-reframe-derivative-work-fixture.ts';

test('accepted long Reframe evidence prepares one bounded crop index for all80 highlight windows', (context) => {
	const count = 12000, sourceEnd = 180000, base = reframeWorkflow(), result = reframeResult();
	const workflow = { ...base, fence: { ...base.fence,
		sourceRanges: base.fence.sourceRanges.map((range) => ({ ...range, sourceEndFrame: sourceEnd })) } };
	result.authority.timescale = 3000;
	result.authority.frames = Array.from({ length: count }, (_, index) => ({ sourceFrame: index * 15, presentationTick: String(index * 1500) }));
	result.path.keyframes = result.authority.frames.map(({ sourceFrame }, index) => ({ sourceFrame,
		authority: 'center', trackIds: [], crop: { left: index % 2 === 0 ? 0.2 : 0.4,
			right: index % 2 === 0 ? 0.48359375 : 0.28359375, top: 0, bottom: 0 } }));
	const accepted = createAssistanceAcceptedReframeDerivativeV1(workflow, result, 9);
	const video = { sourceId: 'video-source', timescale: 3000, sourceSize: { width: 1920, height: 1080 },
		selectionStartFrame: 0, selectionEndFrame: sourceEnd * 1600, reframeEvidence: accepted };
	const path = accepted.result.path.keyframes;
	const expected = Array.from({ length: 80 }, (_, index) => {
		const start = index * 1500 + 1, end = start + 300;
		const boundary = (sourceFrame: number) => ({ sourceFrame, authority: 'center', trackIds: [],
			crop: interpolateAssistanceReframeCropV1(path.map((key) => ({ schemaVersion: 1, ...key })), sourceFrame) });
		return [boundary(start), ...path.filter((key) => key.sourceFrame > start && key.sourceFrame < end - 1), boundary(end - 1)];
	});
	const prepared = prepareOwnedHighlightCropKeyframesV1(video, { width: 9, height: 16 });
	const map = Array.prototype.map; let fullPathClones = 0;
	Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true,
		value: function (this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			if (this.length === count && new Error().stack?.includes('HighlightCrop')) fullPathClones += this.length;
			return map.call(this, callback, receiver);
		} });
	context.after(() => Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true, value: map }));
	for (let index = 0; index < 80; index += 1) {
		const start = index * 1500 + 1;
		assert.deepEqual(prepared(start, start + 300), expected[index]);
	}
	assert.equal(fullPathClones, 0);
});
