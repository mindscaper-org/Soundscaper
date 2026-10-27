/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { visualProjectOptions } from './helpers/framescaper-unified-render-project-fixture.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as FOUNDATION } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperNativeRenderCarrierProjectNativeMedia } from '../src/framescaper/editor-native-render-carrier-project.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { createUnifiedExactRenderVisualPreviewConsumerV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';

test('owned visual frames retain preset availability and track visibility from their immutable plan', () => {
	const count = 100, options = visualProjectOptions();
	const clips = options.clips as Record<string, unknown>[], tracks = options.tracks as Record<string, unknown>[];
	const generator = clips.find(clip => clip.kind === 'generator'), track = tracks.find(item => item.type === 'video');
	assert.ok(generator && track);
	for (let index = 0; index < count; index++) {
		clips.push({ ...generator, id: `generator-${index}`, sequenceStartFrame: 0 });
		tracks.push({ ...track, id: `visual-track-${index}`, name: `Visual ${index}`, clipIds: [`generator-${index}`], solo: false, hidden: false });
	}
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = tracks.map(item => item.id);
	const model = options.visualModel as { adjustmentLayers: Record<string, unknown>[]; presets: Record<string, unknown>[] };
	const sha256 = fingerprintNativeMediaPlan(model.adjustmentLayers[0]).sha256;
	model.presets = Array.from({ length: count }, (_, index) => ({ ...model.presets[0], id: `preset-${index}`, authoredStateSha256: sha256 }));
	const project = createFramescaperProjectNativeMedia(PROFILE, options);
	const authority = createFramescaperNativeRenderPlanAuthorityNativeMedia(project);
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(FOUNDATION,
		framescaperNativeRenderCarrierProjectNativeMedia(project), { ...authority,
			format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
			codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
			canvas: { ...authority.canvas, pixelFormat: 'yuv420p' }, includeAudio: false, audioLayout: null });
	const consumer = createUnifiedExactRenderVisualPreviewConsumerV13(plan);
	const encode = TextEncoder.prototype.encode, find = Array.prototype.find, some = Array.prototype.some;
	let hashes = 0, predicates = 0;
	TextEncoder.prototype.encode = function (value) { hashes++; return encode.call(this, value); };
	Object.defineProperty(Array.prototype, 'find', { configurable: true, writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			return find.call(this, this === plan.tracks ? (value, index, values) => { predicates++; return predicate.call(receiver, value, index, values); } : predicate, receiver);
		} });
	Object.defineProperty(Array.prototype, 'some', { configurable: true, writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			return some.call(this, this === plan.tracks ? (value, index, values) => { predicates++; return predicate.call(receiver, value, index, values); } : predicate, receiver);
		} });
	try {
		for (let frame = 0; frame < 20; frame++) {
			const result = consumer.resolveFrame({ sequencePosition: { num: frame, den: 1 } });
			assert.equal(result.availablePresetIds.length, count);
			assert.deepEqual(result.ledger.requestedNodeIds, result.ledger.consumedNodeIds);
		}
	} finally {
		TextEncoder.prototype.encode = encode;
		Object.defineProperty(Array.prototype, 'find', { configurable: true, writable: true, value: find });
		Object.defineProperty(Array.prototype, 'some', { configurable: true, writable: true, value: some });
	}
	assert.equal(hashes, 0);
	assert.equal(predicates, 0);
});
