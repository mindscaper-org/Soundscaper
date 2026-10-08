/* SPDX-License-Identifier: AGPL-3.0-only */
import type { RecordingSelection, RecordingSourceSegment } from '../controller/recording/recording-transaction-types.ts';
import type { ProjectDocument } from './project-repository.ts';
import type { TakeCycleRecoveryEnvelopeKeyValuePort } from './take-cycle-recovery-envelope-repository.ts';
import { cloneStorageValue } from './storage-clone.ts';

export const RECORDING_RECOVERY_KEY_PREFIX = 'recording-recovery-v1:';
export interface RecordingRecoveryDestination {
	readonly trackId: string;
	readonly startFrame: number;
	readonly sourceOffsetFrames: number;
	readonly sampleRate: number;
	readonly selection: RecordingSelection | null;
}
export interface RecordingRecoveryLane {
	readonly id: string;
	readonly destination: RecordingRecoveryDestination;
	readonly segments: readonly RecordingSourceSegment[];
}
export interface RecordingRecoveryJournal {
	readonly version: 1;
	readonly projectId: string;
	readonly id: string;
	readonly base: ProjectDocument;
	readonly lanes: readonly RecordingRecoveryLane[];
	readonly decision: 'recover' | 'discard' | null;
	readonly targetBase: ProjectDocument | null;
	readonly target: ProjectDocument | null;
	readonly lostCheckpointCount: number;
}

/** One exact recording generation, retained until durable project publication or explicit discard. */
export class RecordingRecoveryJournalRepository {
	readonly #port: TakeCycleRecoveryEnvelopeKeyValuePort;
	constructor(port: TakeCycleRecoveryEnvelopeKeyValuePort) { this.#port = port; }
	async load(projectId: string): Promise<RecordingRecoveryJournal | null> {
		const value = await this.#port.get(key(projectId));
		return value == null ? null : normalizeRecordingRecoveryJournal(value);
	}
	async create(projectId: string, id: string, base: ProjectDocument): Promise<RecordingRecoveryJournal> {
		const record = normalizeRecordingRecoveryJournal({ version: 1, projectId, id, base, lanes: [], decision: null, targetBase: null, target: null });
		if (!await this.#port.putIfAbsent(key(projectId), record)) throw new Error('This project already has an interrupted recording.');
		return record;
	}
	async addLane(expected: RecordingRecoveryJournal, id: string, destination: RecordingRecoveryDestination): Promise<RecordingRecoveryJournal> {
		assertCapturing(expected);
		if (expected.lanes.some((lane) => lane.id === id)) throw new Error('Recording recovery lane already exists.');
		return this.#replace(expected, { ...expected, lanes: [...expected.lanes, { id, destination, segments: [] }] });
	}
	async append(expected: RecordingRecoveryJournal, laneId: string, segment: RecordingSourceSegment): Promise<RecordingRecoveryJournal> {
		assertCapturing(expected);
		const lane = expected.lanes.find(({ id }) => id === laneId);
		if (!lane) throw new Error('Recording recovery destination is unavailable.');
		const previous = lane.segments.at(-1);
		if (segment.frameStart !== (previous ? previous.frameStart + previous.frameCount : 0)) throw new Error('Recording checkpoints must be contiguous.');
		return this.#replace(expected, { ...expected, lanes: expected.lanes.map((entry) => entry === lane ? { ...lane, segments: [...lane.segments, segment] } : entry) });
	}
	async decide(expected: RecordingRecoveryJournal, decision: 'recover' | 'discard', targetBase: ProjectDocument | null = null, target: ProjectDocument | null = null, lostCheckpointCount = 0): Promise<RecordingRecoveryJournal> {
		if (expected.decision !== null) {
			if (expected.decision !== decision) throw new Error('The interrupted recording recovery decision is already recorded.');
			return expected;
		}
		return this.#replace(expected, { ...expected, decision, targetBase, target, lostCheckpointCount });
	}
	async remove(expected: RecordingRecoveryJournal): Promise<void> {
		if (!await this.#port.deleteIfCurrent(key(expected.projectId), expected)) throw new Error('Recording recovery ownership changed before removal.');
	}
	async #replace(expected: RecordingRecoveryJournal, value: unknown): Promise<RecordingRecoveryJournal> {
		const next = normalizeRecordingRecoveryJournal(value);
		if (expected.id !== next.id || expected.projectId !== next.projectId) throw new Error('Recording recovery ownership cannot change.');
		if (!await this.#port.replaceIfCurrent(key(expected.projectId), expected, next)) throw new Error('Recording recovery ownership changed before checkpoint publication.');
		return next;
	}
}

export function normalizeRecordingRecoveryJournal(value: unknown): RecordingRecoveryJournal {
	const row = record(value, 'journal');
	if (row.version !== 1) throw new TypeError('Recording recovery journal version is unsupported.');
	const projectId = identifier(row.projectId, 'projectId');
	const id = identifier(row.id, 'id');
	const base = project(row.base, projectId);
	if (!Array.isArray(row.lanes) || row.lanes.length > 128) throw new TypeError('Recording recovery lanes are invalid.');
	const ids = new Set<string>();
	const sources = new Set<string>();
	const lanes = row.lanes.map((value: unknown): RecordingRecoveryLane => {
		const lane = record(value, 'lane');
		const laneId = identifier(lane.id, 'lane.id');
		if (ids.has(laneId)) throw new TypeError('Recording recovery lane IDs must be unique.');
		ids.add(laneId);
		const destinationValue = record(lane.destination, 'destination');
		const destination = Object.freeze({ trackId: identifier(destinationValue.trackId, 'trackId'),
			startFrame: integer(destinationValue.startFrame, 'startFrame'), sourceOffsetFrames: integer(destinationValue.sourceOffsetFrames, 'sourceOffsetFrames'),
			sampleRate: integer(destinationValue.sampleRate, 'sampleRate', 1), selection: selection(destinationValue.selection) });
		if (!Array.isArray(lane.segments) || lane.segments.length > 86_400) throw new TypeError('Recording recovery segments are invalid.');
		let end = 0;
		const segments = lane.segments.map((value: unknown): RecordingSourceSegment => {
			const segment = record(value, 'segment');
			const sourceId = identifier(segment.sourceId, 'sourceId');
			if (sources.has(sourceId)) throw new TypeError('Recording checkpoint source IDs must be unique.');
			sources.add(sourceId);
			const frameStart = integer(segment.frameStart, 'frameStart');
			const frameCount = integer(segment.frameCount, 'frameCount', 1);
			if (frameStart !== end || !Number.isSafeInteger(frameStart + frameCount)) throw new TypeError('Recording checkpoints must form a contiguous safe prefix.');
			end += frameCount;
			return Object.freeze({ sourceId, frameStart, frameCount, metadata: cloneStorageValue(record(segment.metadata, 'metadata')) });
		});
		return Object.freeze({ id: laneId, destination, segments: Object.freeze(segments) });
	});
	const decision = row.decision;
	if (decision !== null && decision !== 'recover' && decision !== 'discard') throw new TypeError('Recording recovery decision is invalid.');
	const targetBase = row.targetBase == null ? null : project(row.targetBase, projectId);
	const target = row.target == null ? null : project(row.target, projectId);
	if (decision === 'recover' && (!targetBase || !target)) throw new TypeError('Recording recovery must journal its exact publication before saving.');
	const lostCheckpointCount = integer(row.lostCheckpointCount ?? 0, 'lostCheckpointCount');
	if (lostCheckpointCount > lanes.length) throw new TypeError('Recording recovery may lose only one final checkpoint per lane.');
	return Object.freeze({ version: 1, projectId, id, base, lanes: Object.freeze(lanes), decision, targetBase, target, lostCheckpointCount });
}
function assertCapturing(journal: RecordingRecoveryJournal): void { if (journal.decision !== null) throw new Error('Recording recovery is already settling.'); }
function key(projectId: string): string { return `${RECORDING_RECOVERY_KEY_PREFIX}${encodeURIComponent(identifier(projectId, 'projectId'))}`; }
function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.length || value.length > 512 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new TypeError(`Recording recovery ${label} is invalid.`);
	return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new TypeError(`Recording recovery ${label} is invalid.`);
	return Number(value);
}
function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Recording recovery ${label} is invalid.`);
	return value as Readonly<Record<string, unknown>>;
}
function project(value: unknown, projectId: string): ProjectDocument {
	const row = record(value, 'project');
	if (row.id !== projectId) throw new TypeError('Recording recovery project identity changed.');
	return cloneStorageValue(row) as ProjectDocument;
}
function selection(value: unknown): RecordingSelection | null {
	if (value == null) return null;
	const row = record(value, 'selection');
	const startFrame = integer(row.startFrame, 'selection startFrame');
	const endFrame = integer(row.endFrame, 'selection endFrame');
	if (endFrame <= startFrame) throw new TypeError('Recording recovery selection is invalid.');
	return Object.freeze({ startFrame, endFrame });
}
