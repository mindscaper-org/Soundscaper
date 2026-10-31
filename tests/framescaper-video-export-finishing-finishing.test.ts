/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The export-owned RGBA postprocessor and the digest-bound auxiliary asset loader it depends on.
 * The loader is driven against fabricated finishing nodes so every refusal is observable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCubeLutV1 } from '../src/common/imaging/cube-lut-v1.ts';
import { analyzeVideoMotionV1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import {
	loadFramescaperVideoExportFinishingAssetsFinishing,
} from '../src/framescaper/video-export-finishing-finishing.ts';

type Data = Record<string, unknown>;
const SOURCE_SHA = '12'.repeat(32);
const LUT_TEXT = [
	'TITLE "Fixture"', 'LUT_3D_SIZE 2', '0.0 0.0 0.0', '1.0 0.0 0.0', '0.0 1.0 0.0', '1.0 1.0 0.0',
	'0.0 0.0 1.0', '1.0 0.0 1.0', '0.0 1.0 1.0', '1.0 1.0 1.0', '',
].join('\n');

interface Config {
	readonly options?: Data;
	readonly timingViewsBySourceId?: unknown;
	readonly project?: unknown;
	readonly store?: unknown;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

function presentation(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: null, maskMatteIds: [], ...overrides,
	};
}

function grade(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
		saturation: 1, lut: null, ...overrides,
	};
}

function finishingNode(overrides: Data = {}): Data {
	return { visualPresentations: [], processorStacks: [], motionAnalyses: [], ...overrides };
}

function lutReference(overrides: Data = {}): Data {
	const parsed = parseCubeLutV1(LUT_TEXT);
	return {
		storageKey: 'cube-lut-body', sha256: parsed.sha256, byteLength: parsed.byteLength,
		size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax, ...overrides,
	};
}

function loadAssets(node: Data, request: Config = {}) {
	return loadFramescaperVideoExportFinishingAssetsFinishing({
		project: (request.project ?? { sources: [] }) as never,
		...(request.store === undefined ? {} : { store: request.store as never }),
		signal: request.signal ?? new AbortController().signal,
		assertCurrent: request.assertCurrent ?? (() => undefined),
	}, node as never);
}

/** Records every read so deduplication and signal propagation are observable. */
function recordingStore(bodies: readonly (readonly [string, Uint8Array])[], reads: Data[] = []) {
	const byKey = new Map(bodies);
	return {
		reads,
		loadMediaAsset(storageKey: string, loadOptions?: Readonly<{ signal?: AbortSignal }>) {
			reads.push({ storageKey, signal: loadOptions?.signal });
			const bytes = byKey.get(storageKey);
			return Promise.resolve(bytes === undefined ? null : new Blob([bytes as unknown as BlobPart]));
		},
	};
}

function motionFrame(offset: number) {
	const samples = Array.from({ length: 256 }, (_ignored, index) => {
		const x = index % 16;
		const y = (index - x) / 16;
		return x >= 4 + offset && x < 10 + offset && y >= 4 + offset && y < 10 + offset ? 1 : 0;
	});
	return createGrayVideoFrameV1({ width: 16, height: 16, samples });
}

async function motionFixture() {
	const processors = [{
		schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true, maximumFeatures: 16,
		quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 2,
	}, {
		schemaVersion: 1, id: 'temporal-1', kind: 'temporal-denoise', enabled: true,
		motionProvider: 'pyramidal-lucas-kanade', analysisId: 'analysis-1', radius: 1, strength: 0.5,
	}];
	const stack = { schemaVersion: 1, id: 'stack-1', sourceId: 'video-source', processors };
	const analysis = await analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SOURCE_SHA, processorStack: stack,
		frames: [0, 1].map((frameNumber) => ({ frameNumber, frame: motionFrame(frameNumber) })),
	} as never);
	return { stack, analysis };
}

test('a finishing node whose presentations are disabled loads no auxiliary asset at all', async () => {
	const node = finishingNode({
		visualPresentations: [
			presentation({ enabled: false, grade: grade({ lut: lutReference() }), processorStackId: 'stack-1' }),
		],
		processorStacks: [{ id: 'stack-1', sourceId: 'video-source', processors: [] }],
	});

	const assets = await loadAssets(node);

	assert.equal(assets.luts.size, 0, 'a disabled presentation must not pull its LUT body');
	assert.equal(assets.analyses.size, 0);
	assert.ok(Object.isFrozen(assets));
});

test('auxiliary assets with no store refuse the export before any body is read', async () => {
	const node = finishingNode({ visualPresentations: [presentation({ grade: grade({ lut: lutReference() }) })] });

	await assert.rejects(() => loadAssets(node), (error: unknown) => error instanceof Error
		&& /assets are unavailable in this browser runtime/u.test(error.message));
});

test('a presentation or processor naming an absent stack or analysis is refused by reference', async () => {
	const stack = {
		id: 'stack-1', sourceId: 'video-source',
		processors: [{ id: 'spatial-1', kind: 'similarity-stabilization', enabled: true, analysisId: 'analysis-1' }],
	};

	await assert.rejects(
		() => loadAssets(finishingNode({ visualPresentations: [presentation({ processorStackId: 'ghost-stack' })] })),
		(error: unknown) => error instanceof ReferenceError && /stack is unavailable/u.test(error.message),
	);
	await assert.rejects(
		() => loadAssets(finishingNode({
			visualPresentations: [presentation({ processorStackId: 'stack-1' })], processorStacks: [stack],
		})),
		(error: unknown) => error instanceof ReferenceError
			&& /motion analysis analysis-1 is unavailable/u.test(error.message),
	);
});

test('auxiliary references beyond the browser count or byte bound are refused together', async () => {
	const many = Array.from({ length: 257 }, (_ignored, index) => presentation({
		id: `presentation-${String(index)}`,
		grade: grade({ lut: lutReference({ sha256: String(index).padStart(64, '0') }) }),
	}));
	const huge = presentation({ grade: grade({ lut: lutReference({ byteLength: 512 * 1024 * 1024 + 1 }) }) });

	for (const presentations of [many, [huge]]) {
		await assert.rejects(() => loadAssets(finishingNode({ visualPresentations: presentations })),
			(error: unknown) => error instanceof RangeError
				&& /exceed the browser export bound|size warning threshold/u.test(error.message));
	}
});

test('two references sharing one digest but disagreeing on their body are refused as conflicting', async () => {
	const node = finishingNode({
		visualPresentations: [
			presentation({ grade: grade({ lut: lutReference() }) }),
			presentation({ id: 'presentation-2', grade: grade({ lut: lutReference({ storageKey: 'other-key' }) }) }),
		],
	});

	await assert.rejects(() => loadAssets(node), (error: unknown) => error instanceof Error
		&& /has conflicting references/u.test(error.message));
});

test('one cube LUT body is read once per digest and keyed by that digest under the export signal', async () => {
	const controller = new AbortController();
	const store = recordingStore([['cube-lut-body', new TextEncoder().encode(LUT_TEXT)]]);
	const node = finishingNode({
		visualPresentations: [
			presentation({ grade: grade({ lut: lutReference() }) }),
			presentation({ id: 'presentation-2', grade: grade({ lut: lutReference() }) }),
		],
	});

	const assets = await loadAssets(node, { store, signal: controller.signal });

	assert.equal(store.reads.length, 1, 'one digest must not be fetched twice');
	assert.deepEqual(store.reads[0], { storageKey: 'cube-lut-body', signal: controller.signal });
	assert.equal(assets.luts.size, 1);
	assert.equal(assets.luts.get(parseCubeLutV1(LUT_TEXT).sha256)?.size, 2);
});

test('a cube LUT body that is absent, stale or geometrically drifted is refused', async () => {
	const node = (lut: Data) => finishingNode({ visualPresentations: [presentation({ grade: grade({ lut }) })] });
	const whole = recordingStore([['cube-lut-body', new TextEncoder().encode(LUT_TEXT)]]);
	const cases: readonly (readonly [Data, unknown, RegExp])[] = [
		[node(lutReference()), recordingStore([]), /asset cube-lut-body is missing or stale/u],
		[
			node(lutReference()),
			recordingStore([['cube-lut-body', new TextEncoder().encode(`${LUT_TEXT}\n`)]]),
			/asset cube-lut-body is missing or stale/u,
		],
		[
			node(lutReference()),
			{ loadMediaAsset: () => Promise.resolve({ size: parseCubeLutV1(LUT_TEXT).byteLength }) },
			/asset cube-lut-body is missing or stale/u,
		],
		[node(lutReference({ size: 3 })), whole, /geometrically mismatched/u],
	];

	for (const [value, store, pattern] of cases) {
		await assert.rejects(() => loadAssets(value, { store }), (error: unknown) => (
			error instanceof Error && pattern.test(error.message)
		), `${String(pattern)} must refuse its stale body`);
	}
});


test('a motion analysis body is admitted only against its own source digest', async () => {
	const { stack, analysis } = await motionFixture();
	const reference = analysis.reference as unknown as Data;
	const node = finishingNode({
		visualPresentations: [presentation({ processorStackId: 'stack-1' })],
		processorStacks: [stack], motionAnalyses: [reference],
	});
	const store = recordingStore([[String(reference.storageKey), analysis.bytes]]);
	const sources = [{ id: 'video-source', contentSha256: SOURCE_SHA }];

	const assets = await loadAssets(node, { store, project: { sources } });
	assert.deepEqual(assets.analyses.get('analysis-1'), analysis.bytes);
	assert.equal(assets.luts.size, 0);

	const drifted = [{ id: 'video-source', contentSha256: 'ab'.repeat(32) }];
	await assert.rejects(() => loadAssets(node, { store, project: { sources: drifted } }),
		(error: unknown) => error instanceof RangeError
			&& /stale because its input digest changed/u.test(error.message));
});

test('an export cancelled while its store is reading refuses before the body is admitted', async () => {
	const controller = new AbortController();
	const reason = new DOMException('the export was superseded', 'AbortError');
	const node = finishingNode({ visualPresentations: [presentation({ grade: grade({ lut: lutReference() }) })] });
	const store = {
		loadMediaAsset: () => {
			controller.abort(reason);
			return Promise.resolve(new Blob([new TextEncoder().encode(LUT_TEXT)]));
		},
	};

	await assert.rejects(() => loadAssets(node, { store, signal: controller.signal }),
		(error: unknown) => error === reason);
});
