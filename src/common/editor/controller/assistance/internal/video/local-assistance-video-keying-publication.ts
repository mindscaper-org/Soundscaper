/* SPDX-License-Identifier: AGPL-3.0-only */

/** Full-source alpha-video derivatives published through the existing clip/source history. */

import { createLocalAssistanceSelectionFence } from '../local-assistance-selected-media.ts';
import type { AssistanceSelectionFence } from '../../../../assistance/proposal-session.ts';
import { AssistanceProposalStaleError } from '../../../../assistance/proposal-session.ts';
import { createAddSourceCommand, createReplaceClipSourceCommand } from '../../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { createVideoSource } from '../../../../project-media-factory.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity } from '../../../../project-schema-identity.ts';
import { loadSourceProvenanceDerivation } from '../../../../source-provenance-derivation-loader.ts';
import type { SourceProvenanceCarrier } from '../../../../source-provenance-derivation.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../../storage/media-content-digest.ts';
import type { OwnedMediaAssetPublication } from '../../../../storage/media-asset-write-contract.ts';
import { decodeVideoTimingAsset, encodeVideoTimingAsset,
	type VideoTimingAssetInput, type VideoTimingIndex } from '../../../../video-timing-asset.ts';
import { loadVideoTimingAsset, publishVideoTimingAsset,
	type VideoTimingMediaStore } from '../../../../video-timing-storage.ts';
import { normalizeVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25 } from '../../../../video-source-professional-characteristics-v25.ts';

type Data = Readonly<Record<string, unknown>>;
type Rate = Readonly<{ readonly num: number; readonly den: number }>;
type Awaitable<Value> = Value | PromiseLike<Value>;

export interface LocalAssistanceKeyedVideoInspection {
	readonly width: number;
	readonly height: number;
	readonly frameRate: Rate;
	readonly timing: VideoTimingAssetInput;
	readonly characteristics: VideoSourceCharacteristicsV25;
}

/** The emitted object is an opaque, instance-owned run capability; copies cannot publish. */
export interface LocalAssistanceVideoKeyingRun {
	readonly projectId: string;
	readonly clipId: string;
	readonly source: Data;
	readonly width: number;
	readonly height: number;
	readonly sourceFrameCount: number;
	readonly frameRate: Rate;
	readonly selectionFence: AssistanceSelectionFence;
	readonly timescale: number;
	readonly sourceEndTick: bigint;
	readonly presentationTick: (sourceFrame: number) => bigint;
}

export interface LocalAssistanceKeyedVideoResult {
	readonly body: Blob;
	readonly sha256: string;
	readonly modelId: string;
	readonly modelVersion: string;
}

export interface LocalAssistanceVideoKeyingPublicationDependencies {
	readonly getProject: () => unknown;
	readonly getSelectedClipId: () => string | null;
	readonly isReadOnly: () => boolean;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly createId: (prefix: string) => string;
	readonly preflightStorage: (bytes: number, category: 'effect') => Awaitable<unknown>;
	readonly store: VideoTimingMediaStore;
	readonly publishContent: (request: Readonly<{
		storageKey: string; body: Blob; metadata: Data; signal?: AbortSignal;
	}>) => Awaitable<OwnedMediaAssetPublication>;
	/** Probe the supplied immutable body, including its alpha signaling and complete frame inventory. */
	readonly inspectOutput: (body: Blob, options: Readonly<{ signal?: AbortSignal }>) => Awaitable<LocalAssistanceKeyedVideoInspection>;
	/** Synchronous history admission; the current document also proves ownership after callback failures. */
	readonly commit: (command: AudioEditorCommand) => void;
	readonly reloadSourceVisual: (sourceId: string) => Awaitable<unknown>;
}

export interface LocalAssistanceVideoKeyingPublication {
	capture(options?: Readonly<{ signal?: AbortSignal }>): Promise<LocalAssistanceVideoKeyingRun>;
	assertCurrent(run: LocalAssistanceVideoKeyingRun, signal?: AbortSignal): void;
	accept(run: LocalAssistanceVideoKeyingRun, result: LocalAssistanceKeyedVideoResult,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<{ sourceId: string }>>;
}

interface Selection {
	readonly project: Data;
	readonly source: Data;
	readonly clip: Data;
	readonly fingerprint: string;
}

interface RunState {
	readonly selection: Selection;
	readonly token: unknown;
	readonly timing: VideoTimingIndex | null;
	accepted: boolean;
	active: boolean;
}

const MAXIMUM_OUTPUT_BYTES = 8 * 1024 * 1024 * 1024;
const EXTENSION_KEY = 'org.soundscaper.local-assistance-video-keying-v1';

export function createLocalAssistanceVideoKeyingPublication(
	dependencies: LocalAssistanceVideoKeyingPublicationDependencies,
): Readonly<LocalAssistanceVideoKeyingPublication> {
	assertDependencies(dependencies);
	const runs = new WeakMap<LocalAssistanceVideoKeyingRun, RunState>();
	return Object.freeze({ capture, accept, assertCurrent(run: LocalAssistanceVideoKeyingRun, signal?: AbortSignal) {
		const state = runs.get(run);
		if (!state || state.accepted) throw new Error('The captured video keying run is no longer available.');
		assertCurrent(dependencies, state, signal);
	} });

	async function capture(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<LocalAssistanceVideoKeyingRun> {
		options.signal?.throwIfAborted();
		const selection = currentSelection(dependencies);
		const token = dependencies.captureProject();
		const source = selection.source;
		const frameRate = rate(source.frameRate);
		const count = integer(source.sourceFrameCount, 1, 'source frame count');
		const timing = source.timingAsset == null ? null : await loadSourceTiming(dependencies.store, source, options);
		const state: RunState = { selection, token, timing, accepted: false, active: false };
		assertCurrent(dependencies, state, options.signal);
		if (timing) assertConstantRate(timing, frameRate, count);
		const run = Object.freeze({
			projectId: identifier(selection.project.id), clipId: identifier(selection.clip.id),
			source: freeze(structuredClone(source)),
			width: integer(source.width, 1, 'source width'), height: integer(source.height, 1, 'source height'),
			sourceFrameCount: count, frameRate,
			selectionFence: createLocalAssistanceSelectionFence(selection.project as never, selection.clip, source,
				records(selection.project.tracks).find((track) => Array.isArray(track.clipIds)
					&& track.clipIds.includes(selection.clip.id))!, Number(selection.clip.sequenceStartFrame),
				Number(selection.clip.sequenceStartFrame) + Number(selection.clip.sequenceFrameCount), 0, count),
			timescale: timing?.timescale ?? frameRate.num,
			sourceEndTick: timing?.endTicks ?? BigInt(count) * BigInt(frameRate.den),
			presentationTick(sourceFrame: number): bigint {
				if (!Number.isSafeInteger(sourceFrame) || sourceFrame < 0 || sourceFrame >= count) {
					throw new RangeError('The keyed video source ordinal is outside its captured extent.');
				}
				return timing?.presentationTicks[sourceFrame] ?? BigInt(sourceFrame) * BigInt(frameRate.den);
			},
		});
		runs.set(run, state);
		return run;
	}

	async function accept(run: LocalAssistanceVideoKeyingRun, value: LocalAssistanceKeyedVideoResult,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<{ sourceId: string }>> {
		const state = runs.get(run);
		if (!state) throw new TypeError('Video keying requires its original captured run capability.');
		if (state.accepted) throw new Error('This video keying result was already accepted.');
		if (state.active) throw new Error('This video keying run is already publishing.');
		state.active = true;
		const publications: OwnedMediaAssetPublication[] = [];
		let candidateId: string | null = null;
		let admissionAttempted = false;
		try {
			assertCurrent(dependencies, state, options.signal);
			const body = canonicalMediaContentBlob(value.body);
			if (body.type !== 'video/webm' || body.size < 1 || body.size > MAXIMUM_OUTPUT_BYTES) {
				throw new RangeError('Keyed video must be a bounded, nonempty alpha WebM body.');
			}
			const sha256 = digest(value.sha256);
			const modelId = identifier(value.modelId);
			const modelVersion = identifier(value.modelVersion);
			if (await digestMediaContent(body, options) !== sha256) {
				throw new Error('The keyed video bytes disagree with their reviewed content digest.');
			}
			assertCurrent(dependencies, state, options.signal);
			const inspected = validateInspection(await dependencies.inspectOutput(body, options), run, state.timing);
			const timing = inspected.timing;
			assertCurrent(dependencies, state, options.signal);
			await dependencies.preflightStorage(body.size + encodeVideoTimingAsset(timing).byteLength, 'effect');
			const { deriveSourceProvenance } = await loadSourceProvenanceDerivation();
			assertCurrent(dependencies, state, options.signal);
			const sourceId = identifier(dependencies.createId('keyed-video'));
			candidateId = sourceId;
			if (records(state.selection.project.sources).some(({ id }) => id === sourceId)) {
				throw new RangeError('The keyed video source ID is already occupied.');
			}
			const name = `${String(state.selection.source.name)} — Keyed`;
			const published = await dependencies.publishContent({ storageKey: sourceId, body,
				metadata: { name, mimeType: body.type, width: run.width, height: run.height,
					durationSeconds: Number(timing.endTicks) / timing.timescale }, ...options });
			if (!published || typeof published.discardIfCurrent !== 'function') {
				throw new TypeError('Keyed video content publication must retain rollback ownership.');
			}
			publications.push(published);
			if (published.metadata.sha256 !== sha256 || published.metadata.size !== body.size) {
				throw new Error('Published keyed video content disagrees with its reviewed digest and length.');
			}
			assertCurrent(dependencies, state, options.signal);
			const timingPublication = await publishVideoTimingAsset(dependencies.store, sha256, timing, options);
			if (timingPublication.publication) publications.push(timingPublication.publication);
			assertCurrent(dependencies, state, options.signal);
			const provenance = deriveSourceProvenance([state.selection.source as SourceProvenanceCarrier]);
			const source = createVideoSource({
				id: sourceId, storageKey: sourceId, name, mimeType: body.type, contentSha256: sha256,
				sampleFrameCount: integer(state.selection.source.sampleFrameCount, 1, 'source sample extent'),
				sampleRate: integer(state.selection.project.sampleRate, 1, 'project sample rate'),
				sourceFrameCount: run.sourceFrameCount, frameRate: run.frameRate, width: run.width, height: run.height,
				videoCodec: 'vp9', audioCodec: null, hasAudio: false,
				characteristics: inspected.characteristics,
				timingAsset: timingPublication.reference,
				timingDecision: { mode: 'exact', rate: run.frameRate, backend: inspected.characteristics.backend },
				imageSequence: null, proxyAttachment: null, posterStorageKey: null, thumbnailStorageKey: null,
				...(provenance ? { provenance } : {}),
				opaqueExtensions: { [EXTENSION_KEY]: { version: 1, modelId, modelVersion,
					sourceId: state.selection.source.id, sourceSha256: state.selection.source.contentSha256 } },
			}, integer(state.selection.project.sampleRate, 1, 'project sample rate'));
			assertCurrent(dependencies, state, options.signal);
			admissionAttempted = true;
			dependencies.commit({ type: 'batch', commands: [
				createAddSourceCommand(source), createReplaceClipSourceCommand(run.clipId, sourceId),
			] });
			state.accepted = true;
			// History, including Undo/Redo, now owns both immutable bodies. A visual
			// activation failure must never reclaim them after the edit was accepted.
			await dependencies.reloadSourceVisual(sourceId);
			return Object.freeze({ sourceId });
		} catch (error) {
			if (!state.accepted && admissionAttempted && candidateId !== null) {
				let ownershipFailure: unknown;
				try { state.accepted = sourceLanded(dependencies.getProject(), run, candidateId); }
				catch (currencyError) { ownershipFailure = currencyError; }
				if (ownershipFailure !== undefined) throw new AggregateError([error, ownershipFailure],
					'Video keying history ownership could not be checked after admission.', { cause: error });
			}
			if (state.accepted) throw error;
			const failures: unknown[] = [error];
			for (const publication of publications.reverse()) {
				try { await publication.discardIfCurrent(); } catch (cleanup) { failures.push(cleanup); }
			}
			if (failures.length > 1) throw new AggregateError(failures,
				'Video keying publication and cleanup failed.', { cause: error });
			throw error;
		} finally { state.active = false; }
	}
}

function currentSelection(dependencies: LocalAssistanceVideoKeyingPublicationDependencies): Selection {
	if (dependencies.isReadOnly()) throw new Error('Video keying cannot change a read-only project.');
	const project = record(dependencies.getProject(), 'Video keying project');
	const identity = readProjectSchemaIdentity(project);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY || identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new TypeError('Video keying requires a current Framescaper project.');
	}
	const selectedId = identifier(dependencies.getSelectedClipId());
	const selected = record(project.selection, 'Video keying selection');
	const selectedVideos = Array.isArray(selected.clipIds) ? selected.clipIds.filter((id) => (
		records(project.clips).some((clip) => clip.id === id && clip.kind === 'video')
	)) : [];
	if (selectedVideos.length > 1 || selectedVideos.length === 1 && selectedVideos[0] !== selectedId) {
		throw new Error('Video keying requires one selected video occurrence.');
	}
	const clips = records(project.clips).filter(({ id }) => id === selectedId);
	const clip = clips[0];
	if (clips.length !== 1 || !clip || clip.kind !== 'video') throw new TypeError('Select one video occurrence for keying.');
	const sources = records(project.sources).filter(({ id }) => id === clip.sourceId);
	const source = sources[0];
	if (sources.length !== 1 || !source || source.kind !== 'video' || source.imageSequence != null) {
		throw new TypeError('Video keying requires one ordinary video source.');
	}
	const tracks = records(project.tracks).filter((track) => track.type === 'video'
		&& Array.isArray(track.clipIds) && track.clipIds.filter((id) => id === selectedId).length === 1);
	if (tracks.length !== 1) throw new Error('The selected keying occurrence has ambiguous track ownership.');
	if (tracks[0]!.locked === true) throw new Error('The selected keying track is locked.');
	identifier(project.id); integer(project.revision, 0, 'project revision'); digest(source.contentSha256);
	const snapshot = { project: structuredClone(project), source: structuredClone(source), clip: structuredClone(clip) };
	return { ...snapshot, fingerprint: JSON.stringify({ project, selectedId }) };
}

function assertCurrent(dependencies: LocalAssistanceVideoKeyingPublicationDependencies,
	state: RunState, signal?: AbortSignal): void {
	signal?.throwIfAborted();
	dependencies.assertProject(state.token);
	const current = currentSelection(dependencies);
	if (current.fingerprint !== state.selection.fingerprint) throw new AssistanceProposalStaleError();
}

async function loadSourceTiming(store: VideoTimingMediaStore, source: Data,
	options: Readonly<{ signal?: AbortSignal }>): Promise<VideoTimingIndex> {
	const loaded = await loadVideoTimingAsset(store, source.timingAsset, {
		...options, sourceSha256: digest(source.contentSha256),
	});
	if (loaded.status !== 'available' || !loaded.index) throw new Error(`The keying source timing is ${loaded.status}.`);
	return loaded.index;
}

function validateInspection(value: LocalAssistanceKeyedVideoInspection, run: LocalAssistanceVideoKeyingRun,
	sourceTiming: VideoTimingIndex | null): Readonly<{
	timing: VideoTimingIndex; characteristics: VideoSourceCharacteristicsV25;
}> {
	if (value.width !== run.width || value.height !== run.height || !equalRate(rate(value.frameRate), run.frameRate)) {
		throw new RangeError('The keyed video changed its complete source geometry or rational frame rate.');
	}
	const characteristics = normalizeVideoSourceCharacteristicsV25(value.characteristics, { rate: run.frameRate });
	if (characteristics.hasAlpha !== true || characteristics.videoCodec !== 'vp9'
		|| characteristics.codedWidth !== run.width || characteristics.codedHeight !== run.height
		|| characteristics.rotationDegrees !== 0 || characteristics.audioStreams?.length !== 0
		|| characteristics.alphaMode !== 'straight' || characteristics.alphaInterpretation !== 'transparency') {
		throw new RangeError('The keyed video must report straight VP9 transparency and exact frame geometry without audio.');
	}
	const timing = decodeVideoTimingAsset(encodeVideoTimingAsset(value.timing));
	if (timing.frameCount !== run.sourceFrameCount) throw new RangeError('The keyed video lost its full source frame inventory.');
	for (let ordinal = 0; ordinal <= timing.frameCount; ordinal += 1) {
		const tick = ordinal === timing.frameCount ? timing.endTicks : timing.presentationTicks[ordinal]!;
		const expectedTick = sourceTiming === null ? BigInt(ordinal) * BigInt(run.frameRate.den)
			: ordinal === sourceTiming.frameCount ? sourceTiming.endTicks : sourceTiming.presentationTicks[ordinal]!;
		const expectedScale = sourceTiming === null ? run.frameRate.num : sourceTiming.timescale;
		const difference = abs(tick * BigInt(expectedScale) - expectedTick * BigInt(timing.timescale));
		if (difference * 1_000n > BigInt(timing.timescale) * BigInt(expectedScale)) {
			throw new RangeError('The keyed video exceeds the one millisecond presentation timing tolerance.');
		}
	}
	return Object.freeze({ timing, characteristics });
}

function sourceLanded(value: unknown, run: LocalAssistanceVideoKeyingRun, sourceId: string): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const project = value as Data;
	return project.id === run.projectId && Array.isArray(project.sources) && Array.isArray(project.clips)
		&& (project.sources as readonly Data[]).some((source) => source.id === sourceId && source.storageKey === sourceId)
		&& (project.clips as readonly Data[]).some((clip) => clip.id === run.clipId && clip.sourceId === sourceId);
}

function assertConstantRate(timing: VideoTimingIndex, frameRate: Rate, count: number): void {
	if (timing.frameCount !== count) throw new RangeError('The keying source timing frame inventory changed.');
	for (let ordinal = 0; ordinal <= count; ordinal += 1) {
		const tick = ordinal === count ? timing.endTicks : timing.presentationTicks[ordinal]!;
		const difference = abs(tick * BigInt(frameRate.num)
			- BigInt(ordinal) * BigInt(frameRate.den) * BigInt(timing.timescale));
		if (difference > BigInt(frameRate.num)
			|| difference * 1_000n > BigInt(frameRate.num) * BigInt(timing.timescale)) {
			throw new RangeError('Video keying currently requires constant-frame-rate source timing.');
		}
	}
}

function rate(value: unknown): Rate {
	const row = record(value, 'Video keying frame rate');
	return Object.freeze({ num: integer(row.num, 1, 'rate numerator'), den: integer(row.den, 1, 'rate denominator') });
}
function equalRate(left: Rate, right: Rate): boolean {
	return BigInt(left.num) * BigInt(right.den) === BigInt(right.num) * BigInt(left.den);
}
function abs(value: bigint): bigint { return value < 0n ? -value : value; }
function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is unavailable.`);
	return value as Data;
}
function records(value: unknown): readonly Data[] {
	if (!Array.isArray(value)) throw new TypeError('Video keying requires a canonical project inventory.');
	return value.map((row) => record(row, 'Video keying inventory row'));
}
function identifier(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError('Video keying requires a valid stable identity.');
	}
	return value;
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Video keying content digest is invalid.');
	return value;
}
function integer(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError(`Video keying ${name} is invalid.`);
	return Number(value);
}
function freeze<Value>(value: Value): Value {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function assertDependencies(value: LocalAssistanceVideoKeyingPublicationDependencies): void {
	const methods = ['getProject', 'getSelectedClipId', 'isReadOnly', 'captureProject', 'assertProject', 'createId',
		'preflightStorage', 'publishContent', 'inspectOutput', 'commit', 'reloadSourceVisual'] as const;
	if (!value || methods.some((method) => typeof value[method] !== 'function') || !value.store
		|| ['beginMediaAssetWrite', 'getMediaAssetMetadata', 'loadMediaAsset']
			.some((method) => typeof Reflect.get(value.store, method) !== 'function')) {
		throw new TypeError('Video keying publication requires complete controller and owned storage ports.');
	}
}
