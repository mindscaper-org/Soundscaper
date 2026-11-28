/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionAudioDeviceCommand, TracktionAudioDeviceReply, TracktionAudioSetup } from '../src/soundscaper/tracktion-audio-device-contract.ts';
import { isTracktionAutomationValue, TRACKTION_AUTOMATION_RANGES, type TracktionAutomationCommand,
	type TracktionAutomationPage } from '../src/soundscaper/tracktion-automation-contract.ts';
import type { TracktionEffectEdit, TracktionEffectPage } from '../src/soundscaper/tracktion-effect-contract.ts';
import {
	TRACKTION_CLIP_PAGE_SIZE, TRACKTION_TRACK_PAGE_SIZE, type TracktionAutomationPointResult, type TracktionClipCommand, type TracktionClipPage,
	type TracktionEditResult, type TracktionMixCommand, type TracktionProjectPage, type TracktionPasteCommand, type TracktionRangeCommand,
	type TracktionRecordingCommand, type TracktionRecordingResult, type TracktionRenderCommand, type TracktionTrackMix,
	type TracktionTransportCommand, type TracktionTransportObservation, type TracktionTransportView,
} from '../src/soundscaper/tracktion-project-contract.ts';
import { readClosedDomainArray, readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';

import { readTracktionAudioDeviceReply } from './tracktion-audio-device-wire.ts';
import type { TracktionOfflineEffectIdentity } from './tracktion-offline-effects.ts';

export const TRACKTION_CONTROL_BYTES = 64 * 1024;
const PAGE_SIZE = 32;

type Revision = Readonly<{ revision: number }>;
type UseAudioProfile = Readonly<{ kind: 'useAudioProfile' }> & TracktionAudioSetup;

export type TracktionCommand =
	| Readonly<{ kind: 'project'; offset: number }>
	| (Revision & Readonly<{ kind: 'clips'; trackId: string; offset: number }>)
	| (Revision & Readonly<{ kind: 'addTrack'; name: string }>)
	| (Revision & Readonly<{ kind: 'duplicateTrack'; trackId: string }>)
	| (Revision & Readonly<{ kind: 'insertOfflineEffect'; trackId: string }> & TracktionOfflineEffectIdentity)
	| TracktionMixCommand
	| TracktionAutomationCommand
	| TracktionEffectEdit
	| (Revision & Readonly<{
		kind: 'import'; trackId: string; asset: string; name: string; start: number; sourceOffset: number; frames: number;
	}>)
	| (Revision & Readonly<{ kind: 'importFile'; trackId: string; asset: string; name: string; start: number }>)
	| (Revision & TracktionClipCommand)
	| (Revision & TracktionRangeCommand)
	| (Revision & TracktionPasteCommand)
	| (Revision & Readonly<{ kind: 'undo' | 'redo' | 'save' }>)
	| (Revision & TracktionRenderCommand & Readonly<{ asset: string }>)
	| (Revision & Readonly<{ kind: 'archive'; asset: string }>)
	| TracktionAudioDeviceCommand
	| UseAudioProfile
	| Readonly<{ kind: 'transportObservation' }>
	| TracktionTransportCommand
	| TracktionRecordingCommand;

export type TracktionReply<Command extends TracktionCommand> = Command extends { kind: 'project' } ? TracktionProjectPage
	: Command extends { kind: 'trackAutomation' } ? TracktionAutomationPage
		: Command extends { kind: 'clips' } ? TracktionClipPage
		: Command extends { kind: 'offlineEffects' } ? TracktionEffectPage
		: Command extends { kind: 'trackMix' } ? TracktionTrackMix
			: Command extends TracktionAudioDeviceCommand ? TracktionAudioDeviceReply<Command>
				: Command extends UseAudioProfile ? null
					: Command extends { kind: 'transportObservation' } ? TracktionTransportObservation
						: Command extends TracktionTransportCommand | { kind: 'startRecording' } ? TracktionTransportView
							: Command extends { kind: 'setAutomationPoint' } ? TracktionAutomationPointResult
								: Command extends { kind: 'finishRecording' } ? TracktionRecordingResult : TracktionEditResult;

const transportKinds = new Set<TracktionCommand['kind']>([
	'transportStatus', 'prepareOutput', 'play', 'stop', 'seek', 'setLoop', 'startRecording',
]);

export class TracktionRejectedCommand extends Error {}

export function tracktionCommandTimeout(command: TracktionCommand): number {
	return ['render', 'archive', 'copyRange', 'cutRange', 'pasteRange'].includes(command.kind) ? 120_000 : 15_000;
}

export function inspectTracktionReply<Command extends TracktionCommand>(
	parsed: unknown,
	command: Command,
): TracktionReply<Command> {
	const header = readClosedDomainRecord(parsed, 'Tracktion reply', ['ok', 'error', 'detail', 'value'], ['ok']);
	if (header.ok === false) {
		const failure = readClosedDomainRecord(parsed, 'Tracktion refusal', ['ok', 'error', 'detail']);
		const detail = boundedText(failure.detail);
		if (failure.error === 'request') throw new TracktionRejectedCommand(detail);
		if (failure.error === 'session') throw new Error(detail);
		throw new TypeError('Unknown Tracktion refusal.');
	}
	if (header.ok !== true) throw new TypeError('Invalid Tracktion success flag.');
	const { value } = readClosedDomainRecord(parsed, 'Tracktion success', ['ok', 'value']);
	// The command's discriminator selects the closed reply schema.
	if (command.kind === 'project') return readTracktionProjectPage(value, command.offset) as TracktionReply<Command>;
	if (command.kind === 'clips') return readTracktionClipPage(value, command) as TracktionReply<Command>;
	if (command.kind === 'offlineEffects') return readTracktionEffects(value, command) as TracktionReply<Command>;
	if (command.kind === 'trackMix') return readTracktionTrackMix(value) as TracktionReply<Command>;
	if (command.kind === 'trackAutomation') return readTracktionAutomation(value, command) as TracktionReply<Command>;
	if (command.kind === 'audioHosts' || command.kind === 'audioDevices' || command.kind === 'setAudioSetup') {
		return readTracktionAudioDeviceReply(value, command) as TracktionReply<Command>;
	}
	if (command.kind === 'useAudioProfile') {
		if (value !== null) throw new TypeError('Invalid Tracktion audio profile acknowledgement.');
		return value as TracktionReply<Command>;
	}
	if (command.kind === 'transportObservation' || transportKinds.has(command.kind)) {
		return readTracktionTransport(value, command.kind !== 'transportObservation') as TracktionReply<Command>;
	}
	if (!('revision' in command)) throw new TypeError('A Tracktion edit command requires a revision.');
	const fields = command.kind === 'setAutomationPoint' ? ['revision', 'itemId', 'pointIndex'] : ['revision', 'itemId'];
	const permitsInsertion = command.kind === 'addTrack' || command.kind === 'duplicateTrack';
	const finishesRecording = command.kind === 'finishRecording';
	const discarding = finishesRecording && command.discard;
	const editedClipField = command.kind === 'trim' ? 'trimmedClip' : command.kind === 'importFile' ? 'importedClip'
		: finishesRecording && !discarding ? 'recordedClip' : undefined;
	const permitsHistory = permitsInsertion || editedClipField !== undefined || command.kind === 'split'
		|| command.kind === 'setTrackMix' || command.kind === 'setAutomationPoint'
		|| command.kind === 'removeAutomationPoint' || command.kind === 'clearAutomation' || command.kind === 'deleteClip';
	const allowed = permitsHistory ? [...fields, 'history'] : [...fields];
	if (permitsInsertion) allowed.push('insertion');
	if (editedClipField) allowed.push(editedClipField);
	if (command.kind === 'split') allowed.push('splitClips');
	if (finishesRecording) allowed.push('transport');
	const result = readClosedDomainRecord(value, 'Tracktion edit result', allowed, fields);
	const revision = nonnegativeInteger(result.revision);
	const advanced = revision - command.revision;
	// A racing Discard can remove a take that PipeWire already recovered.
	if (advanced < 0 || advanced > (discarding ? 2 : 1) || (discarding && advanced === 1)) {
		throw new TypeError('A Tracktion edit returned an invalid revision.');
	}
	const edited = advanced === 1;
	if ((command.kind === 'copyRange' && edited) || ((command.kind === 'cutRange' || command.kind === 'pasteRange') && !edited)) {
		throw new TypeError('A Tracktion clipboard command returned an invalid revision.');
	}
	const createsItem = permitsInsertion || command.kind === 'import' || command.kind === 'importFile'
		|| command.kind === 'split' || command.kind === 'duplicateClip' || command.kind === 'insertOfflineEffect'
		|| (command.kind === 'finishRecording' && edited && !command.discard);
	const itemId = createsItem ? readItemId(result.itemId) : null;
	if ((!createsItem && result.itemId !== null) || (createsItem && !edited)) {
		throw new TypeError('A Tracktion edit returned an invalid created item.');
	}
	const history = result.history === undefined ? {} : { history: readEditHistory(result.history) };
	const transport = result.transport === undefined ? undefined : readTracktionTransport(result.transport, false);
	if (transport?.recording) throw new TypeError('A finished Tracktion recording is still armed.');
	const edit = { revision, itemId, ...history, ...(transport && { transport }) };
	if (command.kind === 'setAutomationPoint') {
		const pointIndex = nonnegativeInteger(result.pointIndex);
		if (!edited && command.index !== pointIndex) throw new TypeError('Tracktion returned an inconsistent unchanged automation point.');
		return Object.freeze({ revision, itemId: null, pointIndex, ...history }) as TracktionReply<Command>;
	}
	if (editedClipField && result[editedClipField] !== undefined) {
		const placement = readIndexedClip(result[editedClipField]);
		const expectedId = command.kind === 'trim' ? command.clipId : itemId;
		if (!edited || placement.clip.id !== expectedId) throw new TypeError('Tracktion returned an inconsistent edited clip.');
		return Object.freeze({ ...edit, [editedClipField]: placement }) as TracktionReply<Command>;
	}
	if (command.kind === 'split' && result.splitClips !== undefined) {
		const reply = readClosedDomainRecord(result.splitClips, 'Tracktion split clips', ['left', 'right']);
		const left = readIndexedClip(reply.left);
		const right = readIndexedClip(reply.right);
		if (!edited || left.clip.id !== command.clipId || right.clip.id !== itemId || left.clip.id === right.clip.id
			|| left.index === right.index || left.clip.end !== command.frame || right.clip.start !== command.frame) {
			throw new TypeError('Tracktion returned inconsistent split clips.');
		}
		return Object.freeze({ ...edit, splitClips: Object.freeze({ left, right }) }) as TracktionReply<Command>;
	}
	const insertion = result.insertion === undefined ? {} : { insertion: readTrackInsertion(result.insertion, itemId) };
	return Object.freeze({ ...edit, ...insertion }) as TracktionReply<Command>;
}

function readIndexedClip(value: unknown) {
	const { clip, index } = readClosedDomainRecord(value, 'Tracktion edited clip', ['clip', 'index']);
	return Object.freeze({ clip: readClip(clip), index: nonnegativeInteger(index) });
}

function readEditHistory(value: unknown) {
	const { canUndo, canRedo } = readClosedDomainRecord(value, 'Tracktion edit history', ['canUndo', 'canRedo']);
	if (typeof canUndo !== 'boolean' || typeof canRedo !== 'boolean') throw new TypeError('Invalid Tracktion edit history.');
	return Object.freeze({ canUndo, canRedo });
}

function readTrackInsertion(value: unknown, itemId: string | null) {
	const { track, index } = readClosedDomainRecord(value, 'Tracktion track insertion', ['track', 'index']);
	const inserted = readTrack(track);
	if (inserted.id !== itemId) throw new TypeError('Tracktion returned an inconsistent inserted track.');
	return Object.freeze({ track: inserted, index: nonnegativeInteger(index) });
}

function readTracktionTrackMix(value: unknown): TracktionTrackMix {
	const { gainDb, pan, muted, solo } = readClosedDomainRecord(value, 'Tracktion mixer state', ['gainDb', 'pan', 'muted', 'solo']);
	if (typeof gainDb !== 'number' || !Number.isFinite(gainDb) || gainDb < -100 || gainDb > 6
		|| typeof pan !== 'number' || !Number.isFinite(pan) || pan < -1 || pan > 1
		|| typeof muted !== 'boolean' || typeof solo !== 'boolean') throw new TypeError('Invalid Tracktion mixer state.');
	return Object.freeze({ gainDb, pan, muted, solo });
}

const observationRequiredFields = ['playing', 'recording', 'frame'] as const;
const observationFields = [...observationRequiredFields, 'interruptedTake', 'outputInterrupted'] as const;
const transportRequiredFields = ['ready', ...observationRequiredFields] as const;
const transportFields = ['ready', ...observationFields] as const;

function readTracktionTransport(value: unknown, includeReadiness: boolean): TracktionTransportObservation {
	const { ready, playing, recording, frame, interruptedTake, outputInterrupted } = readClosedDomainRecord(
		value, 'Tracktion transport', includeReadiness ? transportFields : observationFields,
		includeReadiness ? transportRequiredFields : observationRequiredFields,
	);
	if ((includeReadiness && typeof ready !== 'boolean') || typeof playing !== 'boolean' || typeof recording !== 'boolean') {
		throw new TypeError('Invalid Tracktion transport state.');
	}
	if (outputInterrupted !== undefined && outputInterrupted !== true) throw new TypeError('Invalid Tracktion output state.');
	const transport = { playing, recording, frame: nonnegativeInteger(frame), ...(typeof ready === 'boolean' ? { ready } : {}),
		...(outputInterrupted ? { outputInterrupted: true as const } : {}) };
	if (interruptedTake === undefined) return Object.freeze(transport);
	if (recording) throw new TypeError('An interrupted Tracktion recording is still armed.');
	const { revision, itemId } = readClosedDomainRecord(interruptedTake, 'Interrupted Tracktion take', ['revision', 'itemId']);
	return Object.freeze({
		...transport,
		interruptedTake: Object.freeze({ revision: nonnegativeInteger(revision), itemId: itemId === null ? null : readItemId(itemId) }),
	});
}

function readTracktionProjectPage(value: unknown, offset: number): TracktionProjectPage {
	const page = readClosedDomainRecord(
		value, 'Tracktion project page', ['revision', 'sampleRate', 'canUndo', 'canRedo', 'tracks', 'nextOffset'],
	);
	const sampleRate = nonnegativeInteger(page.sampleRate);
	if (sampleRate < 8000 || sampleRate > 192_000 || typeof page.canUndo !== 'boolean' || typeof page.canRedo !== 'boolean') {
		throw new TypeError('Invalid Tracktion project page.');
	}
	const tracks = readClosedDomainArray(page.tracks, 'Tracktion tracks', 0, TRACKTION_TRACK_PAGE_SIZE).map(readTrack);
	return Object.freeze({
		revision: nonnegativeInteger(page.revision), sampleRate, canUndo: page.canUndo, canRedo: page.canRedo,
		nextOffset: readNextOffset(page.nextOffset, offset, tracks.length, TRACKTION_TRACK_PAGE_SIZE), tracks: Object.freeze(tracks),
	});
}

function readTrack(value: unknown) {
	const { id, name, clipCount } = readClosedDomainRecord(value, 'Tracktion track', ['id', 'name', 'clipCount']);
	return Object.freeze({ id: readItemId(id), name: boundedText(name), clipCount: nonnegativeInteger(clipCount) });
}

function readClip(value: unknown) {
	const { id, name, start: first, end: last, sourceOffset } = readClosedDomainRecord(
		value, 'Tracktion clip', ['id', 'name', 'start', 'end', 'sourceOffset'],
	);
	const start = nonnegativeInteger(first);
	const end = nonnegativeInteger(last);
	if (end <= start) throw new TypeError('A Tracktion clip has an invalid range.');
	return Object.freeze({ id: readItemId(id), name: boundedText(name), start, end, sourceOffset: nonnegativeInteger(sourceOffset) });
}

function readTracktionClipPage(value: unknown, command: Extract<TracktionCommand, { kind: 'clips' }>): TracktionClipPage {
	const page = readClosedDomainRecord(value, 'Tracktion clip page', ['revision', 'clips', 'nextOffset']);
	if (page.revision !== command.revision) throw new TypeError('A Tracktion clip page has changed revision.');
	const clips = readClosedDomainArray(page.clips, 'Tracktion clips', 0, TRACKTION_CLIP_PAGE_SIZE).map(readClip);
	return Object.freeze({
		revision: command.revision, nextOffset: readNextOffset(page.nextOffset, command.offset, clips.length, TRACKTION_CLIP_PAGE_SIZE),
		clips: Object.freeze(clips),
	});
}

function readNextOffset(value: unknown, offset: number, length: number, pageSize = PAGE_SIZE): number | null {
	if (value === null) return null;
	if (length !== pageSize || value !== offset + pageSize || !Number.isSafeInteger(value)) {
		throw new TypeError('Invalid Tracktion page cursor.');
	}
	return value as number;
}

function readTracktionAutomation(value: unknown, command: Extract<TracktionAutomationCommand, { kind: 'trackAutomation' }>): TracktionAutomationPage {
	const page = readClosedDomainRecord(value, 'Tracktion automation page', ['revision', 'points', 'nextOffset']);
	if (page.revision !== command.revision) throw new TypeError('A Tracktion automation page has changed revision.');
	let previousFrame = -1;
	const points = readClosedDomainArray(page.points, 'Tracktion automation points', 0, PAGE_SIZE).map((entry) => {
		const point = readClosedDomainRecord(entry, 'Tracktion automation point', ['frame', 'value', 'curve']);
		const frame = nonnegativeInteger(point.frame);
		if (frame < previousFrame || !isTracktionAutomationValue(point.value, TRACKTION_AUTOMATION_RANGES[command.parameter])
			|| !isTracktionAutomationValue(point.curve, [-1, 1])) throw new TypeError('Invalid Tracktion automation point.');
		previousFrame = frame;
		return Object.freeze({ frame, value: point.value, curve: point.curve });
	});
	return Object.freeze({ revision: command.revision, points: Object.freeze(points),
		nextOffset: readNextOffset(page.nextOffset, command.offset, points.length) });
}

function readTracktionEffects(value: unknown, command: Extract<TracktionEffectEdit, { kind: 'offlineEffects' }>): TracktionEffectPage {
	const page = readClosedDomainRecord(value, 'Tracktion effects page', ['revision', 'slots', 'nextOffset']);
	if (page.revision !== command.revision) throw new TypeError('A Tracktion effect page has changed revision.');
	const slots = readClosedDomainArray(page.slots, 'Tracktion effects', 0, PAGE_SIZE).map((entry) => {
		const { id, name, format } = readClosedDomainRecord(entry, 'Tracktion effect', ['id', 'name', 'format']);
		return Object.freeze({ id: readItemId(id), name: boundedText(name), format: boundedText(format) });
	});
	return Object.freeze({ revision: command.revision, slots: Object.freeze(slots),
		nextOffset: readNextOffset(page.nextOffset, command.offset, slots.length) });
}

function boundedText(value: unknown): string {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 512) {
		throw new TypeError('Invalid Tracktion text.');
	}
	return value;
}

function nonnegativeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError('Invalid Tracktion integer.');
	}
	return value;
}

function readItemId(value: unknown): string {
	if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) {
		throw new TypeError('Invalid Tracktion item ID.');
	}
	return value;
}
