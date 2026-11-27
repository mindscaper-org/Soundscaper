/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionAudioDeviceCommand, TracktionAudioDeviceReply, TracktionAudioSetup } from '../src/soundscaper/tracktion-audio-device-contract.ts';
import { isTracktionAutomationValue, TRACKTION_AUTOMATION_RANGES, type TracktionAutomationCommand,
	type TracktionAutomationPage } from '../src/soundscaper/tracktion-automation-contract.ts';
import type { TracktionEffectEdit, TracktionEffectPage } from '../src/soundscaper/tracktion-effect-contract.ts';
import type {
	TracktionAutomationPointResult, TracktionClipCommand, TracktionClipPage, TracktionEditResult, TracktionMixCommand, TracktionProjectPage,
	TracktionPasteCommand, TracktionRangeCommand, TracktionRecordingCommand, TracktionRenderCommand, TracktionTrackMix,
	TracktionTransportCommand, TracktionTransportObservation, TracktionTransportView,
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
							: Command extends { kind: 'setAutomationPoint' } ? TracktionAutomationPointResult : TracktionEditResult;

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
	const result = readClosedDomainRecord(value, 'Tracktion edit result', command.kind === 'setAutomationPoint'
		? ['revision', 'itemId', 'pointIndex'] : ['revision', 'itemId']);
	const revision = nonnegativeInteger(result.revision);
	const advanced = revision - command.revision;
	const discarding = command.kind === 'finishRecording' && command.discard;
	// A racing Discard can remove a take that PipeWire already recovered.
	if (advanced < 0 || advanced > (discarding ? 2 : 1) || (discarding && advanced === 1)) {
		throw new TypeError('A Tracktion edit returned an invalid revision.');
	}
	const edited = advanced === 1;
	if ((command.kind === 'copyRange' && edited) || ((command.kind === 'cutRange' || command.kind === 'pasteRange') && !edited)) {
		throw new TypeError('A Tracktion clipboard command returned an invalid revision.');
	}
	const createsItem = command.kind === 'addTrack' || command.kind === 'duplicateTrack' || command.kind === 'import' || command.kind === 'importFile'
		|| command.kind === 'split' || command.kind === 'duplicateClip' || command.kind === 'insertOfflineEffect'
		|| (command.kind === 'finishRecording' && edited && !command.discard);
	const itemId = createsItem ? readItemId(result.itemId) : null;
	if ((!createsItem && result.itemId !== null) || (createsItem && !edited)) {
		throw new TypeError('A Tracktion edit returned an invalid created item.');
	}
	if (command.kind === 'setAutomationPoint') {
		const pointIndex = nonnegativeInteger(result.pointIndex);
		if (!edited && command.index !== pointIndex) throw new TypeError('Tracktion returned an inconsistent unchanged automation point.');
		return Object.freeze({ revision, itemId: null, pointIndex }) as TracktionReply<Command>;
	}
	return Object.freeze({ revision, itemId }) as TracktionReply<Command>;
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
	const tracks = readClosedDomainArray(page.tracks, 'Tracktion tracks', 0, PAGE_SIZE).map((entry) => {
		const item = readClosedDomainRecord(entry, 'Tracktion track', ['id', 'name', 'clipCount']);
		return Object.freeze({
			id: readItemId(item.id), name: boundedText(item.name), clipCount: nonnegativeInteger(item.clipCount),
		});
	});
	return Object.freeze({
		revision: nonnegativeInteger(page.revision), sampleRate, canUndo: page.canUndo, canRedo: page.canRedo,
		nextOffset: readNextOffset(page.nextOffset, offset, tracks.length), tracks: Object.freeze(tracks),
	});
}

function readTracktionClipPage(value: unknown, command: Extract<TracktionCommand, { kind: 'clips' }>): TracktionClipPage {
	const page = readClosedDomainRecord(value, 'Tracktion clip page', ['revision', 'clips', 'nextOffset']);
	if (page.revision !== command.revision) throw new TypeError('A Tracktion clip page has changed revision.');
	const clips = readClosedDomainArray(page.clips, 'Tracktion clips', 0, PAGE_SIZE).map((entry) => {
		const item = readClosedDomainRecord(entry, 'Tracktion clip', ['id', 'name', 'start', 'end', 'sourceOffset']);
		const start = nonnegativeInteger(item.start);
		const end = nonnegativeInteger(item.end);
		if (end <= start) throw new TypeError('A Tracktion clip has an invalid range.');
		return Object.freeze({
			id: readItemId(item.id), name: boundedText(item.name), start, end, sourceOffset: nonnegativeInteger(item.sourceOffset),
		});
	});
	return Object.freeze({
		revision: command.revision, nextOffset: readNextOffset(page.nextOffset, command.offset, clips.length),
		clips: Object.freeze(clips),
	});
}

function readNextOffset(value: unknown, offset: number, length: number): number | null {
	if (value === null) return null;
	if (length !== PAGE_SIZE || value !== offset + PAGE_SIZE || !Number.isSafeInteger(value)) {
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
