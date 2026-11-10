/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transactional publication and optional placement of reviewed enhancement and TIGER results. */

import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../../../../assistance/proposal-session.ts';
import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
} from '../../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { scaleSampleFrame } from '../../../../timeline-time.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../../../../project-media-factory.ts';
import type { SourceProvenanceCarrier } from '../../../../source-provenance-derivation.ts';
import { loadSourceProvenanceDerivation } from '../../../../source-provenance-derivation-loader.ts';
import { publishLocalAssistanceAudioSource } from './local-assistance-audio-source-publication.ts';
import {
	assertLocalAssistanceAudioResultCurrent,
	normalizeLocalAssistanceAudioResult,
	type LocalAssistanceAudioOperation,
	type LocalAssistanceAudioOutputSlot,
	type LocalAssistanceAudioReviewedOutput,
	type NormalizedLocalAssistanceAudioResult,
} from './local-assistance-audio-result-custody.ts';

type DeriveSourceProvenance = typeof import('../../../../source-provenance-derivation.ts')['deriveSourceProvenance'];

type Awaitable<Value> = PromiseLike<Value> | Value;
type DataRecord = Readonly<Record<string, unknown>>;

export type LocalAssistanceEnhancementPlacement = 'project-bin' | 'replace-selection';
export type LocalAssistanceSeparationPlacement = 'project-bin' | 'project-bin-and-muted-tracks' | 'replace-selection';
export type LocalAssistanceAudioPublicationChoice = Readonly<{
	readonly placement?: LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement;
}>;

export interface LocalAssistanceAudioPublicationAuthority {
	readonly project: DataRecord;
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly track: DataRecord;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceAudioSourceWriter {
	readonly framesWritten?: number;
	write(channels: readonly Float32Array[]): Awaitable<unknown>;
	commit(
		metadata?: DataRecord,
		options?: Readonly<{ readonly ifAbsent?: boolean }>,
	): Awaitable<unknown>;
	abort(reason?: unknown): Awaitable<unknown>;
}

export interface LocalAssistanceAudioPublicationStore {
	beginSourceWrite(sourceId: string, metadata: DataRecord): Awaitable<LocalAssistanceAudioSourceWriter>;
	deleteSource(sourceId: string): Promise<unknown>;
}

export interface LocalAssistanceAudioPublicationDependencies {
	readonly currentAuthority: () => LocalAssistanceAudioPublicationAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly createId: (prefix: string) => string;
	readonly preflightStorage: (bytes: number, category: 'effect') => Promise<unknown>;
	readonly store: LocalAssistanceAudioPublicationStore;
	readonly commit: (command: DataRecord, selection?: Readonly<{
		selectClipId: string; selectTrackId: string;
	}>) => void;
}

export interface LocalAssistanceAudioPublicationAcceptance {
	acceptValidatedResult(value: unknown, choice?: LocalAssistanceAudioPublicationChoice): Promise<void>;
}

interface NormalizedAuthority {
	readonly project: DataRecord;
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly track: DataRecord;
	readonly fence: AssistanceSelectionFence;
	readonly projectSampleRate: number;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
}

interface PublicationPlan {
	readonly output: LocalAssistanceAudioReviewedOutput;
	readonly source: DataRecord;
	readonly binClipId: string;
	readonly timelineClipId: string;
	readonly trackId: string;
}

const SOURCE_CHUNK_FRAMES = 65_536;
const EXTENSION_KEY = 'org.soundscaper.local-assistance-audio-v1';
const SOURCE_NAMES = Object.freeze({
	'enhanced-audio': 'Enhanced Dialogue', 'dereverberated-audio': 'Reduced Reverb',
	dialogue: 'Dialogue', music: 'Music', effects: 'Effects',
} satisfies Readonly<Record<LocalAssistanceAudioOutputSlot, string>>);
const OPERATION_SAMPLE_RATES = Object.freeze({
	'speech-enhancement': 48_000, 'dereverberation': 44_100, 'source-separation': 44_100,
} satisfies Readonly<Record<LocalAssistanceAudioOperation, number>>);

export function createLocalAssistanceAudioPublicationAcceptance(
	dependencies: LocalAssistanceAudioPublicationDependencies,
): Readonly<LocalAssistanceAudioPublicationAcceptance> {
	validateDependencies(dependencies);
	return Object.freeze({ acceptValidatedResult });

	async function acceptValidatedResult(
		value: unknown,
		choiceValue: LocalAssistanceAudioPublicationChoice = {},
	): Promise<void> {
		const result = await normalizeLocalAssistanceAudioResult(value);
		const choice = normalizeChoice(choiceValue, result.operation);
		const initial = normalizeAuthority(dependencies.currentAuthority(), result);
		assertSameFence(result.selectionFence, initial.fence);
		const rawPcmBytes = publicationBytes(result.outputs, choice === 'replace-selection'
			? initial.timelineEndFrame - initial.timelineStartFrame : undefined);
		await dependencies.preflightStorage(rawPcmBytes, 'effect');
		assertLocalAssistanceAudioResultCurrent(value, result);
		assertAuthorityCurrent(dependencies, result, initial);
		const { deriveSourceProvenance } = await loadSourceProvenanceDerivation();
		assertLocalAssistanceAudioResultCurrent(value, result);
		assertAuthorityCurrent(dependencies, result, initial);
		let plans = createPublicationPlans(
			dependencies, result, initial, deriveSourceProvenance, choice === 'replace-selection',
		);
		const publishedIds: string[] = [];
		try {
			plans = await publishSourcesBoundedly(dependencies.store, plans, (plan) => {
				publishedIds.push(String(plan.source.id));
				assertLocalAssistanceAudioResultCurrent(value, result);
				assertAuthorityCurrent(dependencies, result, initial);
			});
			const command = publicationCommand(result, initial, plans, choice, dependencies.createId);
			const token = dependencies.captureProject();
			assertAuthorityCurrent(dependencies, result, initial);
			dependencies.assertProject(token);
			assertAuthorityCurrent(dependencies, result, initial);
			assertLocalAssistanceAudioResultCurrent(value, result);
			dependencies.commit(command as unknown as DataRecord, choice === 'replace-selection'
				? { selectClipId: plans[0]!.timelineClipId, selectTrackId: String(initial.track.id) }
				: undefined);
		} catch (error) {
			await rollbackSources(dependencies.store, publishedIds, error);
		}
	}
}

function createPublicationPlans(
	dependencies: LocalAssistanceAudioPublicationDependencies,
	result: NormalizedLocalAssistanceAudioResult,
	authority: NormalizedAuthority,
	deriveSourceProvenance: DeriveSourceProvenance,
	canonicalRate: boolean,
): readonly PublicationPlan[] {
	const provenance = deriveSourceProvenance([
		authority.source as SourceProvenanceCarrier,
	]);
	const occupied = new Set([
		...recordArray(authority.project.sources, 'project sources').map(({ id }) => String(id)),
		...recordArray(authority.project.clips, 'project clips').map(({ id }) => String(id)),
		...recordArray(authority.project.tracks, 'project tracks').map(({ id }) => String(id)),
		...recordArray(record(authority.project.projectBin, 'project bin').clips, 'Project Bin clips')
			.map(({ id }) => String(id)),
	]);
	return Object.freeze(result.outputs.map((output) => {
		const sourceId = uniqueId(dependencies.createId(`assistance-${output.slotId}`), occupied);
		const binClipId = uniqueId(dependencies.createId('assistance-bin-clip'), occupied);
		const timelineClipId = uniqueId(dependencies.createId('assistance-clip'), occupied);
		const trackId = uniqueId(dependencies.createId('assistance-track'), occupied);
		const name = SOURCE_NAMES[output.slotId];
		const source = createAudioSource({
			id: sourceId, storageKey: sourceId, name, kind: 'audio', mimeType: 'audio/wav',
			frameCount: canonicalRate ? authority.timelineEndFrame - authority.timelineStartFrame
				: output.review.frameCount, channelCount: output.review.channelCount,
			sampleRate: canonicalRate ? authority.projectSampleRate : output.review.sampleRate,
			originalSampleRate: output.review.sampleRate,
			sampleFormat: 'float32', chunkFrames: SOURCE_CHUNK_FRAMES,
			contentSha256: output.claim.sha256, byteLength: output.claim.byteLength,
			...(provenance ? { provenance } : {}),
			opaqueExtensions: {
				[EXTENSION_KEY]: {
					version: 1, operation: result.operation, slotId: output.slotId,
					selectionFence: result.selectionFence,
					model: result.models[0], outputClaim: output.claim,
				},
			},
		}) as unknown as DataRecord;
		return Object.freeze({ output, source, binClipId, timelineClipId, trackId });
	}));
}

/** Two bounded stereo separation writers overlap storage without publishing project references early. */
async function publishSourcesBoundedly(
	store: LocalAssistanceAudioPublicationStore,
	plans: readonly PublicationPlan[],
	onPublished: (plan: PublicationPlan) => void,
): Promise<readonly PublicationPlan[]> {
	const published = [...plans];
	let next = 0;
	let failed = false;
	let primaryFailure: unknown;
	async function drain(): Promise<void> {
		while (!failed && next < plans.length) {
			const index = next++, plan = plans[index]!;
			try {
				const source = await publishLocalAssistanceAudioSource(store, plan.source, plan.output, SOURCE_CHUNK_FRAMES);
				published[index] = Object.freeze({ ...plan, source });
				onPublished(plan);
			}
			catch (error) { if (!failed) { primaryFailure = error; failed = true; } }
		}
	}
	await Promise.all(Array.from({ length: Math.min(2, plans.length) }, () => drain()));
	// Every already-admitted writer settles before rollback can delete published source IDs.
	if (failed) throw primaryFailure;
	return Object.freeze(published);
}

function publicationCommand(
	result: NormalizedLocalAssistanceAudioResult,
	authority: NormalizedAuthority,
	plans: readonly PublicationPlan[],
	choice: LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement,
	createId: (prefix: string) => string,
): AudioEditorCommand {
	const commands: AudioEditorCommand[] = [];
	const sequence = authority.fence.sequenceId === authority.project.primarySequenceId
		? {} : { sequenceId: authority.fence.sequenceId };
	if (choice === 'replace-selection') {
		for (const plan of plans) commands.push(createAddSourceCommand(plan.source));
		if (authority.clip.avLinkId != null) {
			commands.push({ type: 'clip/unlink-av', clipId: String(authority.clip.id) });
		}
		commands.push(replacementDeleteCommand(authority, createId));
		for (const [index, plan] of plans.entries()) {
			const trackId = index === 0 ? String(authority.track.id) : plan.trackId;
			if (index > 0) commands.push({
				...createAddTrackCommand(createAudioTrack({
					id: trackId, name: SOURCE_NAMES[plan.output.slotId], mute: false,
				}, authority.projectSampleRate)), ...sequence,
			});
			commands.push(createAddClipCommand(trackId, createTimelineClip(
				plan, authority, plan.timelineClipId,
			)));
		}
		commands.push({ type: 'selection/set', startFrame: authority.timelineStartFrame,
			endFrame: authority.timelineEndFrame, trackIds: [String(authority.track.id)],
			clipIds: [plans[0]!.timelineClipId], frequencyRange: null });
		return Object.freeze({ type: 'batch', commands: Object.freeze(commands) });
	}
	for (const plan of plans) {
		commands.push(createAddSourceCommand(plan.source));
		commands.push({
			type: 'project-bin/add',
			clip: createAudioClip({
				id: plan.binClipId, binItemId: plan.binClipId, sourceId: String(plan.source.id),
				title: SOURCE_NAMES[plan.output.slotId], timelineStartFrame: 0, sourceStartFrame: 0,
				sourceDurationFrames: plan.output.review.frameCount,
				durationFrames: authority.timelineEndFrame - authority.timelineStartFrame,
				avLinkId: null,
			}),
		} as AudioEditorCommand);
	}
	if (result.operation === 'source-separation' && choice === 'project-bin-and-muted-tracks') {
		for (const plan of plans) {
			commands.push({
				...createAddTrackCommand(createAudioTrack({
					id: plan.trackId, name: SOURCE_NAMES[plan.output.slotId], mute: true,
				}, authority.projectSampleRate)),
				...sequence,
			});
			commands.push(createAddClipCommand(plan.trackId, createTimelineClip(
				plan, authority, plan.timelineClipId,
			)));
		}
	}
	return Object.freeze({ type: 'batch', commands: Object.freeze(commands) });
}

function createTimelineClip(
	plan: PublicationPlan,
	authority: NormalizedAuthority,
	clipId: string,
): DataRecord {
	return createAudioClip({
		id: clipId, sourceId: String(plan.source.id), title: SOURCE_NAMES[plan.output.slotId],
		timelineStartFrame: authority.timelineStartFrame, sourceStartFrame: 0,
		sourceDurationFrames: Number(plan.source.frameCount),
		durationFrames: authority.timelineEndFrame - authority.timelineStartFrame,
		avLinkId: null,
	}) as unknown as DataRecord;
}

function replacementDeleteCommand(
	authority: NormalizedAuthority,
	createId: (prefix: string) => string,
): AudioEditorCommand {
	const clipStart = integer(authority.clip.timelineStartFrame, 0, 'selected clip start');
	const clipEnd = safeAdd(clipStart,
		integer(authority.clip.durationFrames, 1, 'selected clip duration'), 'selected clip end');
	const splitClipIds = clipStart < authority.timelineStartFrame && clipEnd > authority.timelineEndFrame
		? Object.freeze({ [String(authority.clip.id)]: createId('assistance-original-right') })
		: Object.freeze({});
	return Object.freeze({
		type: 'range/lift-delete', startFrame: authority.timelineStartFrame,
		endFrame: authority.timelineEndFrame, trackIds: Object.freeze([String(authority.track.id)]),
		clipIds: Object.freeze([String(authority.clip.id)]), splitClipIds,
		splitAvLinkIds: Object.freeze({}), videoEffectIds: Object.freeze({}),
	});
}

function normalizeAuthority(
	value: LocalAssistanceAudioPublicationAuthority,
	result: NormalizedLocalAssistanceAudioResult,
): NormalizedAuthority {
	if (!value || typeof value !== 'object') throw new TypeError('Audio publication requires selected-media authority.');
	const project = record(value.project, 'selected project');
	const source = record(value.source, 'selected source');
	const clip = record(value.clip, 'selected clip');
	const track = record(value.track, 'selected track');
	const fence = validateAssistanceSelectionFence(value.fence);
	if (project.id !== fence.projectId || project.schemaFamily !== fence.schemaFamily
		|| project.schemaVersion !== fence.schemaVersion
		|| project.revision !== fence.revision || source.id !== fence.sourceId
		|| source.contentSha256 !== fence.sourceSha256 || clip.sourceId !== source.id
		|| !fence.occurrenceIds.includes(String(clip.id)) || track.type !== 'audio'
		|| !Array.isArray(track.clipIds) || !track.clipIds.includes(clip.id)) {
		throw new AssistanceProposalStaleError();
	}
	const inventories = [
		[project.sources, source, 'source'], [project.clips, clip, 'clip'], [project.tracks, track, 'track'],
	] as const;
	for (const [candidates, selected, label] of inventories) {
		if (!recordArray(candidates, `project ${label}s`).some(({ id }) => id === selected.id)) {
			throw new AssistanceProposalStaleError();
		}
	}
	const projectSampleRate = integer(project.sampleRate, 1, 'project sample rate');
	const timelineStartFrame = integer(value.startFrame, 0, 'selected timeline start');
	const timelineEndFrame = integer(value.endFrame, 1, 'selected timeline end');
	const sourceStartFrame = integer(value.sourceStartFrame, 0, 'selected source start');
	const sourceEndFrame = integer(value.sourceEndFrame, 1, 'selected source end');
	const duration = timelineEndFrame - timelineStartFrame;
	const sourceRate = integer(source.sampleRate, 1, 'source sample rate');
	const clipSourceStart = integer(clip.sourceStartFrame, 0, 'clip source start');
	const clipTimelineStart = integer(clip.timelineStartFrame, 0, 'clip timeline start');
	if (duration < 1 || sourceEndFrame <= sourceStartFrame
		|| sourceStartFrame !== clipSourceStart + Number(scaleSampleFrame(timelineStartFrame - clipTimelineStart, projectSampleRate, sourceRate, 'point'))
		|| sourceEndFrame !== clipSourceStart + Number(scaleSampleFrame(timelineEndFrame - clipTimelineStart, projectSampleRate, sourceRate, 'point'))
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	const expectedRate = OPERATION_SAMPLE_RATES[result.operation];
	const expectedFrames = Math.round(duration * expectedRate / projectSampleRate);
	const channelCount = integer(source.channelCount, 1, 'selected source channel count');
	if (result.outputs.some(({ review }) => review.sampleRate !== expectedRate
		|| review.frameCount !== expectedFrames || review.channelCount !== channelCount)) {
		throw new RangeError('The reviewed assistance WAV geometry is not exact for the selected range.');
	}
	return Object.freeze({ project, source, clip, track, fence, projectSampleRate,
		timelineStartFrame, timelineEndFrame, sourceStartFrame, sourceEndFrame });
}

function assertAuthorityCurrent(
	dependencies: LocalAssistanceAudioPublicationDependencies,
	result: NormalizedLocalAssistanceAudioResult,
	initial: NormalizedAuthority,
): void {
	const current = normalizeAuthority(dependencies.currentAuthority(), result);
	assertSameFence(result.selectionFence, current.fence);
	if (!same(current.project, initial.project) || !same(current.source, initial.source)
		|| !same(current.clip, initial.clip) || !same(current.track, initial.track)
		|| current.timelineStartFrame !== initial.timelineStartFrame
		|| current.timelineEndFrame !== initial.timelineEndFrame) {
		throw new AssistanceProposalStaleError();
	}
}

function normalizeChoice(
	value: LocalAssistanceAudioPublicationChoice,
	operation: LocalAssistanceAudioOperation,
): LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement {
	const choice = record(value, 'audio publication choice');
	if (Object.keys(choice).some((key) => key !== 'placement')) {
		throw new TypeError('Audio publication choice has an unsupported field.');
	}
	const placement = choice.placement ?? 'replace-selection';
	const allowed = operation === 'speech-enhancement' || operation === 'dereverberation'
		? ['project-bin', 'replace-selection']
		: ['project-bin', 'project-bin-and-muted-tracks', 'replace-selection'];
	if (!allowed.includes(String(placement))) {
		throw new RangeError('Audio publication placement is invalid for this workflow.');
	}
	return placement as LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement;
}

function publicationBytes(outputs: readonly LocalAssistanceAudioReviewedOutput[], frameCount?: number): number {
	const bytes = outputs.reduce((sum, { review }) => (
		sum + (frameCount ?? review.frameCount) * review.channelCount * Float32Array.BYTES_PER_ELEMENT
	), 0);
	if (!Number.isSafeInteger(bytes) || bytes < 1) {
		throw new RangeError('Assistance audio publication exceeds safe capacity accounting.');
	}
	return bytes;
}

async function rollbackSources(
	store: LocalAssistanceAudioPublicationStore,
	ids: readonly string[],
	cause: unknown,
): Promise<never> {
	const errors: unknown[] = [];
	for (const id of [...ids].reverse()) {
		try { await store.deleteSource(id); }
		catch (error) { errors.push(error); }
	}
	if (errors.length) throw new AggregateError([cause, ...errors],
		'Assistance audio acceptance and rollback both failed.', { cause });
	throw cause;
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (!same(left, right)) throw new AssistanceProposalStaleError();
}

function uniqueId(value: unknown, occupied: Set<string>): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256 || occupied.has(value)) {
		throw new RangeError('Assistance audio publication received a colliding stable ID.');
	}
	occupied.add(value);
	return value;
}

function record(value: unknown, label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as DataRecord;
}

function recordArray(value: unknown, label: string): readonly DataRecord[] {
	if (!Array.isArray(value) || value.some((candidate) => !candidate
		|| typeof candidate !== 'object' || Array.isArray(candidate))) {
		throw new TypeError(`The ${label} must be a record array.`);
	}
	return value as readonly DataRecord[];
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${label} exceeds safe timing.`);
	return result;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validateDependencies(value: LocalAssistanceAudioPublicationDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.createId !== 'function' || typeof value.preflightStorage !== 'function'
		|| typeof value.commit !== 'function' || !value.store || typeof value.store !== 'object'
		|| typeof value.store.beginSourceWrite !== 'function'
		|| typeof value.store.deleteSource !== 'function') {
		throw new TypeError('Audio publication acceptance requires its exact controller ports.');
	}
}
