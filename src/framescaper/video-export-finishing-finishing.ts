/* SPDX-License-Identifier: AGPL-3.0-only */

/** Digest-bound auxiliary assets for selected V13 finishing. */

import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../common/editor/controller/shared/file-size-warning.ts';
import {
	parseCubeLutV1,
	type ParsedCubeLutV1,
	type VideoCubeLutReferenceV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	requireVideoMotionAnalysisBodyV1,
	type VideoMotionAnalysisBodyV1,
} from '../common/editor/video-motion-analysis-v27.ts';
import type { VideoMotionAnalysisReferenceV1 } from '../common/editor/video-motion-model-v27.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import type { UnifiedExactRenderFinishingNode } from '../common/editor/unified-exact-render-plan.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';

export interface FramescaperVideoExportFinishingAssetStoreFinishing {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<BlobLike | null>;
}

export interface FramescaperVideoExportFinishingAssetsFinishing {
	readonly analyses: ReadonlyMap<string, VideoMotionAnalysisBodyV1>;
	readonly luts: ReadonlyMap<string, ParsedCubeLutV1>;
}

export interface FramescaperVideoFinishingAssetLoadRequestFinishing extends FileSizeWarningOptions {
	readonly project: FramescaperProjectFinishing;
	readonly store?: FramescaperVideoExportFinishingAssetStoreFinishing;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

const MAXIMUM_AUXILIARY_ASSETS = 256;
const MAXIMUM_AUXILIARY_BYTES = 512 * 1024 * 1024;

export async function loadFramescaperVideoExportFinishingAssetsFinishing(
	request: FramescaperVideoFinishingAssetLoadRequestFinishing,
	finishing: UnifiedExactRenderFinishingNode,
): Promise<FramescaperVideoExportFinishingAssetsFinishing> {
	const presentations = finishing.visualPresentations.filter(({ enabled }) => enabled);
	const lutReferences = uniqueBy(
		presentations.flatMap(({ grade }) => grade?.lut ? [grade.lut] : []),
		(reference) => reference.sha256,
	);
	const stackById = new Map(finishing.processorStacks.map((stack) => [stack.id, stack]));
	const analysisById = new Map(finishing.motionAnalyses.map((analysis) => [analysis.id, analysis]));
	const analysisReferences = uniqueBy(presentations.flatMap((presentation) => {
		if (presentation.processorStackId === null) return [];
		const stack = stackById.get(presentation.processorStackId);
		if (!stack) throw new ReferenceError('Selected V13 finishing stack is unavailable.');
		return stack.processors.flatMap((processor) => (
			processor.enabled && (processor.kind === 'similarity-stabilization'
				|| processor.kind === 'temporal-denoise')
				? [requiredAnalysis(analysisById, processor.analysisId)] : []
		));
	}), (reference) => reference.id);
	const references = [...lutReferences, ...analysisReferences];
	if (references.length > MAXIMUM_AUXILIARY_ASSETS) {
		throw new RangeError('Selected finishing finishing assets exceed the browser export bound.');
	}
	await confirmFileSizeWarning(references.reduce((total, reference) => total + reference.byteLength, 0), MAXIMUM_AUXILIARY_BYTES, 'Video export finishing assets', request);
	if (references.length > 0 && request.store === undefined) {
		throw new Error('Selected finishing finishing assets are unavailable in this browser runtime.');
	}
	const luts = new Map<string, ParsedCubeLutV1>();
	for (const reference of lutReferences) {
		const bytes = await loadAsset(request, reference);
		const parsed = parseCubeLutV1(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		assertLutReference(reference, parsed);
		luts.set(reference.sha256, parsed);
	}
	const analyses = new Map<string, VideoMotionAnalysisBodyV1>();
	const sourceValues = (request.project as unknown as Readonly<Record<string, unknown>>).sources;
	if (!Array.isArray(sourceValues)) throw new TypeError('Selected finishing finishing sources are unavailable.');
	const sourceById = new Map(sourceValues.map((sourceValue) => {
		const source = record(sourceValue, 'Selected finishing finishing source');
		return [String(source.id), source] as const;
	}));
	for (const reference of analysisReferences) {
		const bytes = await loadAsset(request, reference);
		const stack = stackById.get(reference.processorStackId)!;
		const source = sourceById.get(reference.sourceId) as Readonly<{ contentSha256?: unknown }> | undefined;
		const analysis = requireVideoMotionAnalysisBodyV1(reference, bytes, {
			inputSha256: source?.contentSha256 as string,
			processorStack: stack,
		});
		analyses.set(reference.id, analysis);
	}
	return Object.freeze({ analyses, luts });
}

async function loadAsset(
	request: FramescaperVideoFinishingAssetLoadRequestFinishing,
	reference: Readonly<{ storageKey: string; byteLength: number }>,
): Promise<Uint8Array<ArrayBuffer>> {
	assertReady(request);
	const blob = await request.store!.loadMediaAsset(reference.storageKey, { signal: request.signal });
	assertReady(request);
	if (!blob || blob.size !== reference.byteLength || typeof blob.arrayBuffer !== 'function') {
		throw new Error(`Selected finishing finishing asset ${reference.storageKey} is missing or stale.`);
	}
	const bytes = Uint8Array.from(new Uint8Array(await blob.arrayBuffer()));
	assertReady(request);
	return bytes;
}

function requiredAnalysis(
	byId: ReadonlyMap<string, VideoMotionAnalysisReferenceV1>,
	id: string,
): VideoMotionAnalysisReferenceV1 {
	const reference = byId.get(id);
	if (!reference) throw new ReferenceError(`Selected finishing motion analysis ${id} is unavailable.`);
	return reference;
}

function uniqueBy<Value>(values: readonly Value[], key: (value: Value) => string): readonly Value[] {
	const result = new Map<string, Value>();
	for (const value of values) {
		const identity = key(value);
		const current = result.get(identity);
		if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
			throw new Error(`Selected finishing finishing asset ${identity} has conflicting references.`);
		}
		result.set(identity, value);
	}
	return Object.freeze([...result.values()]);
}

function assertLutReference(reference: VideoCubeLutReferenceV1, body: ParsedCubeLutV1): void {
	if (reference.sha256 !== body.sha256 || reference.byteLength !== body.byteLength
		|| reference.size !== body.size
		|| JSON.stringify(reference.domainMin) !== JSON.stringify(body.domainMin)
		|| JSON.stringify(reference.domainMax) !== JSON.stringify(body.domainMax)) {
		throw new RangeError('Selected finishing cube LUT body is missing, stale, or geometrically mismatched.');
	}
}

function assertReady(
	request: FramescaperVideoFinishingAssetLoadRequestFinishing,
): void {
	if (request.signal.aborted) {
		throw request.signal.reason ?? new DOMException('Selected finishing export was cancelled.', 'AbortError');
	}
	request.assertCurrent();
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}
