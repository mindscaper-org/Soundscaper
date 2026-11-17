/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample } from '../common/editor/sequence-frame-navigation.ts';
import { projectTrackFolderMediaStateV12 } from '../common/editor/track-folder-media-runtime.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { createFramescaperImageTimelineTickMapperV1 } from '../common/editor/timeline-image-model.ts';
import type {
	ProductVideoVisualPreviewCreateRequest,
	ProductVideoVisualPreviewFrame,
	ProductVideoVisualPreviewSession,
	ProductVideoVisualProjectBinThumbnail,
	ProductVideoVisualProjectBinThumbnailRequest,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import type { VideoCanvasFit } from '../common/editor/video-canvas-fit.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import { createVisibleVideoTrackPredicate } from '../common/editor/video-track-visibility.js';
import {
	fitFramescaperImagePreviewSizeTimelineImage,
	framescaperImageSourceForClipTimelineImage,
	openFramescaperStoredImageFramePackTimelineImage,
	scaleFramescaperImageRgbaTimelineImage,
	throwIfFramescaperImagePreviewAbortedTimelineImage,
	type FramescaperImageClipV1,
} from './editor-selected-timeline-image-image-frame-source.ts';
import {
	admitFramescaperImageProjectBinThumbnailResourcesTimelineImage,
	admitFramescaperImageTimelinePreviewResourcesTimelineImage,
	assertFramescaperImagePreviewReaderMetadataTimelineImage,
	FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_TIMELINE_IMAGE,
	type FramescaperImagePreviewResourceContextTimelineImage,
} from './editor-selected-timeline-image-image-preview-resources.ts';
import {
	createFramescaperImagePreviewPrefetchTimelineImage,
	disposeFramescaperImagePreviewFramesTimelineImage,
	openFramescaperImagePreviewFramesTimelineImage,
	type FramescaperImagePreviewFramesTimelineImage,
} from './editor-selected-timeline-image-image-preview-frames.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import {
	cloneFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperImagePreviewVideoTimelineImage {
	readonly drawable: unknown;
	readonly videoWidth: number;
	readonly videoHeight: number;
	readonly readyState: 4;
	readonly currentTime: 0;
	pause(): void;
}

export interface FramescaperImagePreviewDrawableTimelineImage {
	readonly video: FramescaperImagePreviewVideoTimelineImage;
	/** Consume the borrowed picture synchronously. */
	present(rgba: Uint8Array<ArrayBuffer>): void;
	dispose(): void;
}

export type CreateFramescaperImagePreviewDrawableTimelineImage = (request: Readonly<{
	readonly clipId: string;
	readonly sourceId: string;
	readonly width: number;
	readonly height: number;
}>) => FramescaperImagePreviewDrawableTimelineImage;

export type CreateFramescaperInheritedVisualPreviewSessionTimelineImage = (
	request: ProductVideoVisualPreviewCreateRequest,
) => Promise<ProductVideoVisualPreviewSession | null>;

export interface FramescaperSelectedVisualPreviewOptionsTimelineImage
	extends ProductVideoVisualPreviewCreateRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly signal?: AbortSignal;
	readonly createImageDrawable?: CreateFramescaperImagePreviewDrawableTimelineImage;
	readonly createInheritedSession?: CreateFramescaperInheritedVisualPreviewSessionTimelineImage;
	readonly cloneProject?: (profile: unknown, project: unknown) => FramescaperProjectTimelineImage;
}

export interface FramescaperSelectedProjectBinThumbnailOptionsTimelineImage
	extends ProductVideoVisualProjectBinThumbnailRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly createInheritedThumbnail?: (
		request: ProductVideoVisualProjectBinThumbnailRequest,
	) => Promise<ProductVideoVisualProjectBinThumbnail | null>;
	readonly cloneProject?: (profile: unknown, project: unknown) => FramescaperProjectTimelineImage;
}

interface ImageClipPreviewTimelineImage {
	readonly clip: FramescaperImageClipV1;
	readonly loaded: FramescaperImagePreviewFramesTimelineImage;
	readonly trackId: string;
	readonly trackIndex: number;
	readonly sourceTicksAt: (sequenceFrame: number) => bigint;
	readonly drawable: FramescaperImagePreviewDrawableTimelineImage;
	lastFrameIndex: number;
}

/** Compose authenticated timelineImage image pictures with the retained nativeMedia/finishing preview session. */
export async function createFramescaperSelectedVisualPreviewSessionTimelineImage(
	options: FramescaperSelectedVisualPreviewOptionsTimelineImage,
): Promise<ProductVideoVisualPreviewSession | null> {
	const project = admittedProject(options?.profile, options?.project, options?.cloneProject);
	const canvas = previewCanvas(options?.width, options?.height, options?.fit);
	throwIfFramescaperImagePreviewAbortedTimelineImage(options.signal);
	const contexts = imageClipContexts(project);
	const plannedSources = planTimelineSources(project, contexts, canvas);
	admitFramescaperImageTimelinePreviewResourcesTimelineImage(contexts.map(({ clip }) => {
		const planned = required(plannedSources, clip.sourceId, 'planned image source');
		return { source: planned.source, width: planned.width, height: planned.height };
	}));
	const inheritedFactory = options.createInheritedSession ?? ((request) => (
		createDefaultInheritedSession(request, options.store)
	));
	const inheritedPromise = Promise.resolve().then(() => inheritedFactory({ project, ...canvas }));
	const imagePromise = openFramescaperImagePreviewFramesTimelineImage(
		options.store, [...plannedSources.values()], options.signal,
	);
	const [inheritedResult, imageResult] = await Promise.allSettled([
		inheritedPromise, imagePromise,
	]);
	if (inheritedResult.status === 'rejected' && imageResult.status === 'rejected') {
		throw new AggregateError(
			[inheritedResult.reason, imageResult.reason],
			'The timelineImage inherited and image preview routes both failed.',
		);
	}
	if (inheritedResult.status === 'rejected') {
		if (imageResult.status === 'fulfilled') disposeFramescaperImagePreviewFramesTimelineImage(imageResult.value);
		throw inheritedResult.reason;
	}
	if (imageResult.status === 'rejected') {
		disposeInheritedSession(inheritedResult.value);
		throw imageResult.reason;
	}
	const inherited = inheritedResult.value;
	const loaded = imageResult.value;
	const clips: ImageClipPreviewTimelineImage[] = [];
	try {
		throwIfFramescaperImagePreviewAbortedTimelineImage(options.signal);
		const bySourceId = new Map(loaded.map((source) => [source.source.id, source]));
		const createDrawable = options.createImageDrawable ?? createCanvasDrawable;
		for (const context of contexts) {
			const source = required(bySourceId, context.clip.sourceId, 'loaded image source');
			const drawable = createDrawable({
				clipId: context.clip.id,
				sourceId: source.source.id,
				width: source.width,
				height: source.height,
			});
			try { assertDrawable(drawable, source.width, source.height); }
			catch (error) { disposeDrawable(drawable); throw error; }
			clips.push({ ...context, loaded: source, drawable, lastFrameIndex: -1 });
		}
	} catch (error) {
		disposeClipDrawables(clips);
		disposeFramescaperImagePreviewFramesTimelineImage(loaded);
		disposeInheritedSession(inherited);
		throw error;
	}
	if (inherited === null && clips.length === 0) return null;
	let disposed = false;
	const schedulePrefetch = createFramescaperImagePreviewPrefetchTimelineImage();
	const imageFrame = (timelineSampleValue: number): ProductVideoVisualPreviewFrame => {
		if (disposed) throw new Error('The selected timelineImage image preview session is disposed.');
		throwIfFramescaperImagePreviewAbortedTimelineImage(options.signal);
		return resolveImageFrame(project, clips, timelinePosition(timelineSampleValue), canvas, schedulePrefetch);
	};
	const resolve = (timelineSample: number): ProductVideoVisualPreviewFrame => {
		try {
			return mergePreviewFrames(inherited?.resolve(timelinePosition(timelineSample)) ?? emptyFrame(), imageFrame(timelineSample));
		} catch (error) {
			schedulePrefetch();
			throw error;
		}
	};
	// Active images require the layered compositor because the exact session omits their tracks.
	const renderExact = inherited?.renderExact;
	return Object.freeze({
		resolve,
		resolveTransitionWeight(clipId: string, timelineSample: number): number | null {
			if (disposed) throw new Error('The selected timelineImage image preview session is disposed.');
			return inherited?.resolveTransitionWeight(
				stableId(clipId, 'timelineImage transition clip ID'), timelinePosition(timelineSample),
			) ?? null;
		},
		...(renderExact ? { async renderExact(request: Readonly<{
			readonly timelineSample: number;
			readonly mediaLayers: readonly unknown[];
		}>) {
			const sample = timelinePosition(request.timelineSample);
			const images = imageFrame(sample);
			if (images.layers.length) throw new Error('Active images require layered preview.');
			const result = await renderExact.call(inherited, {
				timelineSample: sample,
				mediaLayers: request.mediaLayers,
			});
			return Object.freeze({ ...result, frame: mergePreviewFrames(result.frame, images) });
		} } : {}),
		dispose(): void {
			if (disposed) return;
			disposed = true;
			schedulePrefetch();
			disposeClipDrawables(clips);
			disposeFramescaperImagePreviewFramesTimelineImage(loaded);
			disposeInheritedSession(inherited);
		},
	});
}

/** Read the Project Bin image's source-start picture through the same authenticated pack. */
export async function createFramescaperSelectedProjectBinThumbnailTimelineImage(
	options: FramescaperSelectedProjectBinThumbnailOptionsTimelineImage,
): Promise<ProductVideoVisualProjectBinThumbnail | null> {
	const project = admittedProject(options?.profile, options?.project, options?.cloneProject);
	const clipId = stableId(options?.clipId, 'timelineImage Project Bin image clip ID');
	const clipValue = project.projectBin.clips.find(({ id }) => String(id) === clipId);
	if (!clipValue || clipValue.kind !== 'image') {
		return (options.createInheritedThumbnail ?? ((request) => (
			createDefaultInheritedThumbnail(request, options.store)
		)))({ ...options, project });
	}
	const clip = clipValue as FramescaperImageClipV1;
	const source = framescaperImageSourceForClipTimelineImage(project.sources, clip);
	const width = positiveDimension(options.width, 'timelineImage Project Bin thumbnail width');
	const height = positiveDimension(options.height, 'timelineImage Project Bin thumbnail height');
	admitFramescaperImageProjectBinThumbnailResourcesTimelineImage(source, width, height);
	const reader = await openFramescaperStoredImageFramePackTimelineImage(
		options.store, source, options.signal,
		(byteLength) => { assertFramescaperImagePreviewReaderMetadataTimelineImage(source, byteLength); },
	);
	const frameIndex = reader.frameIndexAtTicks(BigInt(clip.sourceStartTicks));
	const rgba = await reader.readFrame(frameIndex, options.signal);
	let pixels: Uint8Array<ArrayBuffer>;
	try {
		pixels = scaleFramescaperImageRgbaTimelineImage(
			rgba, source.canonical.width, source.canonical.height,
			width, height, options.signal,
		);
	} finally { rgba.fill(0); }
	return Object.freeze({
		clipId,
		sourceId: source.id,
		width,
		height,
		pixels,
		opacity: 1,
		blendMode: 'normal',
		presentationIds: Object.freeze([]),
		maskIds: Object.freeze([]),
	});
}

function imageClipContexts(project: FramescaperProjectTimelineImage): readonly Omit<ImageClipPreviewTimelineImage,
	'loaded' | 'drawable' | 'lastFrameIndex'>[] {
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	if (!sequence) throw new ReferenceError('The selected timelineImage primary sequence is unavailable.');
	const sequenceTrackIds = new Set(sequence.trackIds);
	const videoTracks = projectTrackFolderMediaStateV12(project).tracks
		.filter(track => track.type === 'video').filter(({ id }) => sequenceTrackIds.has(id));
	const visible = createVisibleVideoTrackPredicate(videoTracks);
	const output: Omit<ImageClipPreviewTimelineImage, 'loaded' | 'drawable' | 'lastFrameIndex'>[] = [];
	for (const clip of project.clips) {
		if (clip.kind !== 'image' || clip.sequenceId !== sequence.id) continue;
		const owner = videoTracks.find(({ clipIds }) => clipIds.includes(clip.id));
		if (!owner || !visible(owner)) continue;
		const trackIndex = sequence.trackIds.indexOf(owner.id);
		if (trackIndex < 0) throw new ReferenceError(`timelineImage image track ${owner.id} is outside its sequence.`);
		output.push({ clip, trackId: owner.id, trackIndex,
			sourceTicksAt: createFramescaperImageTimelineTickMapperV1(clip, sequence.rate) });
		if (output.length > FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_TIMELINE_IMAGE) {
			throw new RangeError('timelineImage image timeline preview exceeds its context count bound.');
		}
	}
	return Object.freeze(output.sort((left, right) => left.trackIndex - right.trackIndex
		|| left.clip.sequenceStartFrame - right.clip.sequenceStartFrame
		|| compareText(left.clip.id, right.clip.id)));
}

function planTimelineSources(
	project: FramescaperProjectTimelineImage,
	contexts: readonly Omit<ImageClipPreviewTimelineImage, 'loaded' | 'drawable' | 'lastFrameIndex'>[],
	canvas: Readonly<{ width: number; height: number; fit?: VideoCanvasFit }>,
): ReadonlyMap<string, FramescaperImagePreviewResourceContextTimelineImage> {
	const output = new Map<string, FramescaperImagePreviewResourceContextTimelineImage>();
	for (const { clip } of contexts) {
		if (output.has(clip.sourceId)) continue;
		const source = framescaperImageSourceForClipTimelineImage(project.sources, clip);
		output.set(source.id, Object.freeze({
			source,
			...fitFramescaperImagePreviewSizeTimelineImage(source, canvas.width, canvas.height, canvas.fit),
		}));
	}
	return output;
}

function resolveImageFrame(
	project: FramescaperProjectTimelineImage,
	clips: readonly ImageClipPreviewTimelineImage[],
	timelineSample: number,
	canvas: Readonly<{ width: number; height: number }>,
	schedulePrefetch: (next?: () => void) => void,
): ProductVideoVisualPreviewFrame {
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId)!;
	const sequenceFrame = sequenceFrameAtSample(timelineSample, sequence.rate, project.sampleRate);
	const layers = new Map<string, { trackId: string; trackIndex: number; entries: Data[] }>();
	const nodes: string[] = [];
	let prefetch: (() => void) | undefined;
	for (const context of clips) {
		const clip = context.clip;
		if (sequenceFrame < clip.sequenceStartFrame
			|| sequenceFrame >= clip.sequenceStartFrame + clip.sequenceFrameCount) continue;
		const sourceTicks = context.sourceTicksAt(sequenceFrame);
		const address = { sourceTicks, frameIndex: context.loaded.reader.frameIndexAtTicks(sourceTicks) };
		if (context.lastFrameIndex !== address.frameIndex) {
			context.drawable.present(context.loaded.read(address.frameIndex));
			context.lastFrameIndex = address.frameIndex;
		}
		if (sequenceFrame + 1 < clip.sequenceStartFrame + clip.sequenceFrameCount) {
			prefetch ??= context.loaded.prefetchAfter(address.frameIndex);
		}
		const layer = layers.get(context.trackId) ?? {
			trackId: context.trackId, trackIndex: context.trackIndex, entries: [],
		};
		layer.entries.push(imageEntry(context, address, canvas));
		layers.set(context.trackId, layer);
		nodes.push(`render:image:${clip.id}`);
	}
	schedulePrefetch(prefetch);
	const ids = uniqueSorted(nodes);
	return Object.freeze({
		layers: Object.freeze([...layers.values()].map((layer) => Object.freeze({
			...layer, entries: Object.freeze(layer.entries),
		}))),
		adjustments: Object.freeze([]),
		activeFreezeNodeIds: Object.freeze([]),
		availablePresetIds: Object.freeze([]),
		ledger: Object.freeze({ requestedNodeIds: ids, consumedNodeIds: ids, omittedNodeIds: Object.freeze([]) }),
	});
}

function imageEntry(
	context: ImageClipPreviewTimelineImage,
	address: Readonly<{ sourceTicks: bigint; frameIndex: number }>,
	canvas: Readonly<{ width: number; height: number }>,
): Data {
	const source = context.loaded.source;
	return Object.freeze({
		kind: 'image', role: 'single', clipId: context.clip.id, sourceId: source.id,
		source, clip: context.clip, available: true, video: context.drawable.video,
		effects: Object.freeze([]), opacity: 1,
		displayWidth: source.canonical.width, displayHeight: source.canonical.height,
		renderDescription: resolveVideoRenderDescription({
			composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			sourceDisplaySize: { width: source.canonical.width, height: source.canonical.height },
			canvas,
			opacityStart: 1,
		}),
		imageFrameIndex: address.frameIndex,
		imageSourceTicks: address.sourceTicks.toString(),
	});
}

function mergePreviewFrames(
	left: ProductVideoVisualPreviewFrame,
	right: ProductVideoVisualPreviewFrame,
): ProductVideoVisualPreviewFrame {
	const layers = mergeVisualLayers(left.layers, right.layers);
	return Object.freeze({
		layers,
		...(right.layers.length ? { requiresLayeredPreview: true } : {}),
		adjustments: Object.freeze([...left.adjustments, ...right.adjustments]),
		activeFreezeNodeIds: uniqueSorted([...left.activeFreezeNodeIds, ...right.activeFreezeNodeIds]),
		availablePresetIds: uniqueSorted([...left.availablePresetIds, ...right.availablePresetIds]),
		ledger: Object.freeze({
			requestedNodeIds: uniqueSorted([...left.ledger.requestedNodeIds, ...right.ledger.requestedNodeIds]),
			consumedNodeIds: uniqueSorted([...left.ledger.consumedNodeIds, ...right.ledger.consumedNodeIds]),
			omittedNodeIds: uniqueSorted([...left.ledger.omittedNodeIds, ...right.ledger.omittedNodeIds]),
		}),
	});
}

function mergeVisualLayers(
	left: ProductVideoVisualPreviewFrame['layers'],
	right: ProductVideoVisualPreviewFrame['layers'],
): ProductVideoVisualPreviewFrame['layers'] {
	const output = left.map((layer) => ({ ...layer, entries: [...layer.entries] }));
	for (const layer of right) {
		const existing = output.find(({ trackId }) => trackId === layer.trackId);
		if (!existing) output.push({ ...layer, entries: [...layer.entries] });
		else {
			if (existing.trackIndex !== layer.trackIndex) throw new RangeError('timelineImage preview track order is ambiguous.');
			existing.entries.push(...layer.entries);
		}
	}
	return Object.freeze(output.map((layer) => Object.freeze({
		...layer, entries: Object.freeze(layer.entries),
	})));
}

function emptyFrame(): ProductVideoVisualPreviewFrame {
	const empty = Object.freeze([]) as readonly string[];
	return Object.freeze({
		layers: Object.freeze([]), adjustments: Object.freeze([]),
		activeFreezeNodeIds: empty, availablePresetIds: empty,
		ledger: Object.freeze({ requestedNodeIds: empty, consumedNodeIds: empty, omittedNodeIds: empty }),
	});
}

async function createDefaultInheritedSession(
	request: ProductVideoVisualPreviewCreateRequest,
	store: AudioEditorProjectStore,
): Promise<ProductVideoVisualPreviewSession | null> {
	const module = await import('./editor-selected-finishing-visual-preview.ts');
	return module.createFramescaperSelectedVisualPreviewSessionFinishing({
		...request,
		project: framescaperProjectFinishingFoundationShapeNativeMedia(
			framescaperProjectNativeMediaFoundationShapeTimelineImage(request.project),
		),
		profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		store,
	});
}

async function createDefaultInheritedThumbnail(
	request: ProductVideoVisualProjectBinThumbnailRequest,
	store: AudioEditorProjectStore,
): Promise<ProductVideoVisualProjectBinThumbnail | null> {
	const module = await import('./editor-selected-finishing-visual-preview.ts');
	return module.createFramescaperSelectedProjectBinThumbnailFinishing({
		...request,
		project: framescaperProjectFinishingFoundationShapeNativeMedia(
			framescaperProjectNativeMediaFoundationShapeTimelineImage(request.project),
		),
		profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		store,
	});
}

function createCanvasDrawable(request: Readonly<{
	clipId: string; sourceId: string; width: number; height: number;
}>): FramescaperImagePreviewDrawableTimelineImage {
	if (!globalThis.document?.createElement || typeof globalThis.ImageData !== 'function') {
		throw new Error('Selected timelineImage image preview requires a browser canvas runtime.');
	}
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = request.width;
	canvas.height = request.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Selected timelineImage image preview has no 2D canvas context.');
	return Object.freeze({
		video: Object.freeze({
			drawable: canvas, videoWidth: request.width, videoHeight: request.height,
			readyState: 4 as const, currentTime: 0 as const, pause() {},
		}),
		present(rgba: Uint8Array<ArrayBuffer>) {
			context.putImageData(new ImageData(
				new Uint8ClampedArray(rgba), request.width, request.height,
			), 0, 0);
		},
		dispose() {
			context.clearRect(0, 0, request.width, request.height);
			canvas.width = 0;
			canvas.height = 0;
		},
	});
}

function assertDrawable(value: FramescaperImagePreviewDrawableTimelineImage, width: number, height: number): void {
	if (!value || typeof value !== 'object' || typeof value.present !== 'function'
		|| typeof value.dispose !== 'function' || !value.video
		|| value.video.videoWidth !== width || value.video.videoHeight !== height) {
		throw new TypeError('A timelineImage image preview drawable has invalid dimensions or lifecycle ports.');
	}
}

function disposeClipDrawables(clips: ImageClipPreviewTimelineImage[]): void {
	for (const clip of clips) disposeDrawable(clip.drawable);
	clips.length = 0;
}

function disposeDrawable(drawable: FramescaperImagePreviewDrawableTimelineImage): void {
	try { drawable.dispose(); } catch { /* Continue releasing sibling preview resources. */ }
}

function disposeInheritedSession(session: ProductVideoVisualPreviewSession | null): void {
	try { session?.dispose(); } catch { /* Continue releasing timelineImage image resources. */ }
}

function admittedProject(
	profile: unknown,
	value: unknown,
	cloneProject: ((profile: unknown, project: unknown) => FramescaperProjectTimelineImage) | undefined,
): FramescaperProjectTimelineImage {
	return (cloneProject ?? cloneFramescaperProjectTimelineImage)(profile, value);
}

function previewCanvas(
	width: unknown,
	height: unknown,
	fit: VideoCanvasFit | undefined,
): Readonly<{ width: number; height: number; fit?: VideoCanvasFit }> {
	const even = (value: unknown, name: string) => {
		const dimension = positiveDimension(value, name);
		return Math.max(2, dimension - dimension % 2);
	};
	// Playback and export are the same render, so the delivery fit the export
	// applies has to reach the image placement here too.
	return Object.freeze({
		width: even(width, 'timelineImage preview width'),
		height: even(height, 'timelineImage preview height'),
		...(fit === undefined ? {} : { fit }),
	});
}

function positiveDimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}

function timelinePosition(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError('timelineImage preview sample must be non-negative.');
	return Number(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return Object.freeze([...new Set(values)].sort(compareText));
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function required<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key, name: string): Value {
	const value = map.get(key);
	if (value === undefined) throw new ReferenceError(`timelineImage ${name} is unavailable.`);
	return value;
}
