/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { normalizeVideoGeneratorSourceV1, normalizeVideoGeneratorClipV1, normalizeVideoAdjustmentLayerV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { applyUnifiedExactLinearAdjustmentV13 } from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import { renderAuthority, freshness } from './helpers/framescaper-unified-render-project-fixture.ts';

async function picture(opacity: number | null, blendMode: 'normal' | 'multiply' = 'normal', color = '#ff000080') {
	const source = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator', id: 'red', name: 'Translucent',
		width: 4, height: 2, frameRate: { num: 10, den: 1 }, frameCount: 10, generator: { kind: 'solid', color } });
	const clip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'picture', sourceId: source.id,
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 });
	const adjustment = normalizeVideoAdjustmentLayerV1({ schemaVersion: 1, kind: 'adjustment-layer', id: 'neutral',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, targetTrackIds: ['pictures'], effectIds: [] });
	const project = createFramescaperProjectFinishing(PROFILE, { id: 'adjustment-coverage', primarySequenceId: 'main-sequence',
		clips: [{ ...clip }], tracks: [{ id: 'pictures', type: 'video', clipIds: [clip.id] }],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['pictures'] }],
		visualModel: { generatorSources: [source], adjustmentLayers: opacity === null ? [] : [adjustment] },
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }],
			visualPresentations: opacity === null ? [] : [{ schemaVersion: 1, id: 'adjustment-style', owner: { kind: 'adjustment-layer', id: adjustment.id },
				enabled: true, opacity, blendMode, grade: null, processorStackId: null, maskMatteIds: [] }] } });
	const authority = renderAuthority(project, 10);
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, { ...authority,
		canvas: { ...authority.canvas, width: 4, height: 2 }, visualFreshnessByModelId: new Map([
			[clip.id, freshness({ source, clip })], ...(opacity === null ? [] : [[adjustment.id, freshness(adjustment)] as const])]) });
	const lifetime = new AbortController();
	const execution = await createFramescaperSelectedExactFrameExecutionFinishing({ project, plan,
		timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, authority.timingViews),
		signal: lifetime.signal, assertCurrent() {} });
	const target = new Uint8Array(32);
	try {
		await execution.render({ sequencePosition: { num: 0, den: 1 }, width: 4, height: 2, target, signal: lifetime.signal, layers: [] });
		return target;
	} finally { await execution.dispose(); }
}

for (const blend of ['normal', 'multiply'] as const) for (const opacity of [0, 0.5, 1]) {
	test(`a neutral ${blend} adjustment at${opacity} retains translucent source coverage`, async () => {
		const original = await picture(null);
		assert.deepEqual([...original.slice(0, 4)], [188, 0, 0, 255]);
		assert.deepEqual(await picture(opacity, blend), original);
	});
}

test('a neutral adjustment also leaves an opaque picture unchanged', async () => {
	assert.deepEqual(await picture(1, 'normal', '#ff0000ff'), await picture(null, 'normal', '#ff0000ff'));
});

for (const weight of [0, 0.5, 1]) test(`adjustment replacement at${weight} interpolates premultiplied endpoints once`, () => {
	const target = { width: 1, height: 1, pixels: Float64Array.of(0.25, 0.125, 0, 0.5) };
	const adjusted = { width: 1, height: 1, pixels: Float64Array.of(0.125, 0.25, 0, 0.5) };
	applyUnifiedExactLinearAdjustmentV13(target, adjusted, 'normal', weight);
	assert.deepEqual([...target.pixels], [0.25 - 0.125 * weight, 0.125 + 0.125 * weight, 0, 0.5]);
});

test('an adjustment mask controls replacement amount without changing neutral coverage', () => {
	const target = { width: 2, height: 1, pixels: Float64Array.of(0.25, 0.125, 0, 0.5, 0.25, 0.125, 0, 0.5) };
	const adjusted = { ...target, pixels: Float64Array.of(0.125, 0.25, 0, 0.5, 0.125, 0.25, 0, 0.5) };
	applyUnifiedExactLinearAdjustmentV13(target, adjusted, 'normal', 1, Uint8Array.of(0, 255));
	assert.deepEqual([...target.pixels], [0.25, 0.125, 0, 0.5, 0.125, 0.25, 0, 0.5]);
});

test('nonnormal adjustment blends unassociated colour while retaining its original coverage', () => {
	const target = { width: 1, height: 1, pixels: Float64Array.of(0.25, 0.125, 0, 0.5) };
	applyUnifiedExactLinearAdjustmentV13(target, { ...target, pixels: Float64Array.of(0.125, 0.25, 0, 0.5) }, 'multiply', 1);
	assert.deepEqual([...target.pixels], [0.0625, 0.0625, 0, 0.5]);
});

test('invalid adjustment weights or masks refuse before changing the target', () => {
	const target = { width: 1, height: 1, pixels: Float64Array.of(0.25, 0.125, 0, 0.5) }, original = target.pixels.slice();
	assert.throws(() => applyUnifiedExactLinearAdjustmentV13(target, target, 'normal', -0.1), RangeError);
	assert.throws(() => applyUnifiedExactLinearAdjustmentV13(target, target, 'normal', 1, new Uint8Array(0)), RangeError);
	assert.deepEqual(target.pixels, original);
});
