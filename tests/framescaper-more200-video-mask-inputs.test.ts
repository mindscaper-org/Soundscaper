/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { captureSelectedFinishingVideoMaskInputs } from '../src/framescaper/selected-finishing-video-mask-inputs.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../src/common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { renderAuthority, freshness } from './helpers/framescaper-unified-render-project-fixture.ts';

function fixture(kind: 'alpha' | 'raster' | null, otherSource = false) {
	const source = createVideoSource({ id: 'camera', name: 'Camera', storageKey: 'camera.webm', mimeType: 'video/webm',
		contentSha256: '12'.repeat(32), frameRate: { num: 10, den: 1 }, sourceFrameCount: 10,
		sampleFrameCount: 48_000, width: 4, height: 2 });
	const mask = { schemaVersion: 1, id: 'plate-mask', kind: 'mask', inputs: [{ name: 'Plate', sourceRef: otherSource ? 'matte-camera' : source.id,
		kind: kind === 'alpha' ? 'alpha' : 'raster' }], nodes: [{ id: 'coverage', kind: kind ?? 'alpha', inputName: 'Plate',
		...(kind === 'raster' ? { channel: 'red' } : {}) }], outputNodeId: 'coverage' };
	const project = createFramescaperProjectFinishing(PROFILE, { id: 'video-mask-input', sampleRate: 48_000,
		sources: [source, ...(otherSource ? [{ ...source, id: 'matte-camera', storageKey: 'matte-camera.webm' }] : [])],
		clips: ['picture', ...(otherSource ? ['matte'] : [])].map(id => ({ kind: 'video', id,
			sourceId: id === 'matte' ? 'matte-camera' : source.id, sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 })),
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['picture'] },
			...(otherSource ? [{ id: 'matte-track', type: 'video', clipIds: ['matte'] }] : [])],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['pictures', ...(otherSource ? ['matte-track'] : [])] }], primarySequenceId: 'main-sequence',
		visualModel: { maskMattes: kind === null ? [] : [mask] }, finishing: { visualPresentations: [{
			schemaVersion: 1, id: 'masked-picture', owner: { kind: 'clip', id: 'picture' }, enabled: true, opacity: 1,
			blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: kind === null ? [] : [mask.id],
		}] } });
	const authority = renderAuthority(project, 10);
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, { ...authority,
		canvas: { ...authority.canvas, width: 4, height: 2 }, visualFreshnessByModelId: new Map(kind === null ? [] : [[mask.id, freshness(mask)]]) });
	return { project, authority, plan, source };
}

async function renderMask(kind: 'alpha' | 'raster' | null) {
	const { project, authority, plan, source } = fixture(kind);
	let captures = 0;
	const execution = await createFramescaperSelectedExactFrameExecutionFinishing({ project, plan,
		timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, authority.timingViews),
		signal: new AbortController().signal, assertCurrent() {}, captureFrame() {
			captures++;
			return { width: 4, height: 2, pixels: Uint8Array.from({ length: 32 }, (_, index) => [128, 255, 0, 255][index % 4] ?? 0) };
		}, async applyEffects(frame) { return frame; } });
	const target = new Uint8Array(32);
	try {
		await execution.render({ sequencePosition: { num: 0, den: 1 }, width: 4, height: 2, target,
			signal: new AbortController().signal, layers: [{ trackId: 'pictures', entries: [{ clipId: 'picture', sourceId: source.id,
				presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 }, displayWidth: 4, displayHeight: 2,
				renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 4, height: 2 } },
					sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 }, effects: [],
			}] }] });
		return { captures, pixel: [...target.slice(0, 4)] };
	} finally { await execution.dispose(); }
}

for (const kind of [null, 'alpha', 'raster'] as const) test(`selected exact frame delivery retains ${kind ?? 'unmasked'} video source pixels`, async () => {
	const result = await renderMask(kind);
	assert.equal(result.captures, 1, 'a mask must reuse the exact source capture rather than seek twice');
	assert.equal(result.pixel[1], kind === 'raster' ? 180 : 255, 'half red coverage attenuates the opaque green plate in linear light');
	assert.equal(result.pixel[2], 0); assert.equal(result.pixel[3], 255);
});

function maskOptions(otherSource = false) {
	const { plan } = fixture('alpha', otherSource);
	const finishing = plan.nodes.find(node => node.kind === 'finishing'); assert.ok(finishing);
	const masks = new Map(plan.nodes.flatMap(node => node.kind === 'visual' && node.modelKind === 'mask-matte'
		&& 'inputs' in node.authoredState ? [[node.modelId, node.authoredState] as const] : []));
	const clips = new Map(plan.nodes.flatMap(node => node.kind === 'clip' ? [[node.clipId, node] as const] : []));
	const entry = { clipId: 'picture', sourceId: 'camera', presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 } };
	let count = 0;
	const inputs = new Map<string, UnifiedExactRenderRgbaFrameV13>();
	return { entry, inputs, count: () => count, options: { clips, finishing, masks, inputs,
		sourceIdByNodeId: new Map(plan.sources.map(source => [source.nodeId, source.sourceId])),
		visualMasks: [], layers: [{ entries: [entry] }], signal: new AbortController().signal,
		capture() { count++; return { width: 1, height: 1, pixels: Uint8Array.of(11, 22, 33, 255) }; },
	} };
}

test('video mask inputs are available before the first consumer and captured once per exact source frame', async () => {
	const { options, entry, inputs, count } = maskOptions();
	const repeated = { ...entry };
	const captures = await captureSelectedFinishingVideoMaskInputs({ ...options, layers: [{ entries: [entry, repeated] }] });
	assert.equal(count(), 1); assert.equal(captures.get(entry), captures.get(repeated));
	assert.deepEqual(inputs.get('camera')?.pixels, Uint8Array.of(11, 22, 33, 255));
});

test('one source reference cannot silently select between different simultaneous source frames', async () => {
	const { options, entry } = maskOptions();
	const different = { ...entry, presentationDescriptor: { drawableSourceFrame: 1, outerCell: 0 } };
	await assert.rejects(captureSelectedFinishingVideoMaskInputs({ ...options, layers: [{ entries: [entry, different] }] }), /ambiguous active source frames/u);
});

test('a mask never widens the exact plan source authority', async () => {
	const { options, entry, count } = maskOptions();
	await assert.rejects(captureSelectedFinishingVideoMaskInputs({ ...options,
		layers: [{ entries: [{ ...entry, sourceId: 'unadmitted-source' }] }] }), /changed source authority/u);
	assert.equal(count(), 0);
});

test('an aborted mask read keeps its original cancellation and publishes no raw pixels', async () => {
	const { options, inputs } = maskOptions();
	const lifetime = new AbortController(), reason = new Error('cancel mask frame');
	await assert.rejects(captureSelectedFinishingVideoMaskInputs({ ...options, signal: lifetime.signal,
		capture() { lifetime.abort(reason); return { width: 1, height: 1, pixels: Uint8Array.of(11, 22, 33, 255) }; },
	}), error => error === reason);
	assert.equal(inputs.size, 0);
});

test('inactive graphs add no source reads to an unmasked programme frame', async () => {
	const { options, count } = maskOptions();
	const captures = await captureSelectedFinishingVideoMaskInputs({ ...options,
		finishing: { ...options.finishing, visualPresentations: [] } });
	assert.equal(captures.size, 0); assert.equal(count(), 0);
});


test('a clip can consume the raw video mask supplied by a later layer occurrence', async () => {
	const { options, entry, inputs, count } = maskOptions(true);
	const later = { ...entry, clipId: 'matte', sourceId: 'matte-camera' };
	const captures = await captureSelectedFinishingVideoMaskInputs({ ...options, layers: [{ entries: [entry, later] }] });
	assert.equal(count(), 1); assert.equal(captures.has(entry), false);
	assert.equal(captures.get(later), inputs.get('matte-camera'));
	assert.deepEqual(inputs.get('matte-camera')?.pixels, Uint8Array.of(11, 22, 33, 255));
});
