/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { normalizeVideoGeneratorSourceV1, normalizeVideoGeneratorClipV1, normalizeVideoAdjustmentLayerV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { renderAuthority, freshness } from './helpers/framescaper-unified-render-project-fixture.ts';

async function deliveredPixels(generator: boolean, adjustment = false) {
	const source = createVideoSource({ id: 'camera', name: 'Camera', storageKey: 'camera.webm', mimeType: 'video/webm',
		contentSha256: '12'.repeat(32), frameRate: { num: 10, den: 1 }, sourceFrameCount: 10,
		sampleFrameCount: 48_000, width: 256, height: 2 });
	const visualSource = { schemaVersion: 1, kind: 'generator', id: 'black-level', name: 'Shadow', width: 256, height: 2,
		frameRate: { num: 10, den: 1 }, frameCount: 10, generator: { kind: 'solid', color: '#040404ff' } };
	const clip = { schemaVersion: 1, kind: 'generator', id: 'picture', sourceId: 'black-level', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 };
	const project = createFramescaperProjectFinishing(PROFILE, { id: 'shadow-precision', sampleRate: 48_000,
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] },
		primarySequenceId: 'main-sequence', sources: generator ? [] : [source], clips: generator ? [clip] : [{ kind: 'video', id: 'picture',
			sourceId: source.id, sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['picture'] }], sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['pictures'] }],
		visualModel: { generatorSources: generator ? [visualSource] : [], adjustmentLayers: adjustment ? [{ schemaVersion: 1,
			kind: 'adjustment-layer', id: 'neutral-adjustment', sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			targetTrackIds: ['pictures'], effectIds: [] }] : [] } });
	const authority = renderAuthority(project, 10);
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, { ...authority,
		canvas: { ...authority.canvas, width: 256, height: 2 }, visualFreshnessByModelId: new Map([
			...(generator ? [['picture', freshness({ source: normalizeVideoGeneratorSourceV1(visualSource), clip: normalizeVideoGeneratorClipV1(clip) })] as const] : []),
			...(adjustment ? [['neutral-adjustment', freshness(normalizeVideoAdjustmentLayerV1({ schemaVersion: 1, kind: 'adjustment-layer',
				id: 'neutral-adjustment', sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, targetTrackIds: ['pictures'], effectIds: [] }))] as const] : [])]) });
	const pixels = Uint8Array.from({ length: 256 * 2 * 4 }, (_, index) => index % 4 === 3 ? 255 : Math.floor(index / 4) % 256);
	const execution = await createFramescaperSelectedExactFrameExecutionFinishing({ project, plan,
		timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, authority.timingViews),
		signal: new AbortController().signal, assertCurrent() {}, captureFrame() { return { width: 256, height: 2, pixels }; } });
	const target = new Uint8Array(pixels.length);
	try {
		await execution.render({ sequencePosition: { num: 0, den: 1 }, width: 256, height: 2, target,
			signal: new AbortController().signal, layers: generator ? [] : [{ trackId: 'pictures', entries: [{ clipId: 'picture', sourceId: source.id,
				presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 }, displayWidth: 256, displayHeight: 2,
				renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 256, height: 2 } },
					sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 }, effects: [] }] }] });
		return { target, pixels };
	} finally { await execution.dispose(); }
}

for (const adjustment of [false, true]) test(`an identity exact video picture retains every encoded byte${adjustment ? ' through a neutral adjustment' : ''}`, async () => {
	const { target, pixels } = await deliveredPixels(false, adjustment);
	assert.deepEqual(target, pixels);
});

test('a dark authored solid retains its admitted source colour through exact finishing', async () => {
	const { target } = await deliveredPixels(true);
	assert.deepEqual([...target.slice(0, 4)], [4, 4, 4, 255]);
});
