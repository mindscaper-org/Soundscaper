/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';
import { isTracktionAutomationParameter, isTracktionAutomationValue, TRACKTION_AUTOMATION_RANGES } from '../src/soundscaper/tracktion-automation-contract.ts';
import type { TracktionProjectCommand } from '../src/soundscaper/tracktion-project-contract.ts';

import { readTracktionAudioDeviceId, readTracktionAudioSetup, tracktionAudioSetupFields } from './tracktion-audio-device-wire.ts';

const SESSION_ID = /^[a-f0-9]{32}$/u;
const ITEM_ID = /^[1-9][0-9]{0,19}$/u;
const rangeFields = ['kind', 'sessionId', 'revision', 'mode', 'trackId', 'start', 'end'] as const;
const renderRangeFields = ['kind', 'sessionId', 'revision', 'start', 'end'] as const;
const automationFields = ['kind', 'sessionId', 'revision', 'trackId', 'parameter'] as const;
const fields = {
	create: ['kind', 'sampleRate'],
	open: ['kind'],
	project: ['kind', 'sessionId', 'offset'],
	clips: ['kind', 'sessionId', 'revision', 'trackId', 'offset'],
	addTrack: ['kind', 'sessionId', 'revision', 'name'],
	duplicateTrack: ['kind', 'sessionId', 'revision', 'trackId'],
	trackMix: ['kind', 'sessionId', 'revision', 'trackId'],
	trackAutomation: [...automationFields, 'offset'],
	setAutomationPoint: [...automationFields, 'index', 'frame', 'value', 'curve'],
	removeAutomationPoint: [...automationFields, 'index'],
	clearAutomation: automationFields,
	offlineEffects: ['kind', 'sessionId', 'revision', 'trackId', 'offset'],
	offlineEffectCatalog: ['kind', 'sessionId'],
	scanOfflineEffects: ['kind', 'sessionId'],
	addOfflineEffect: ['kind', 'sessionId', 'revision', 'trackId', 'installationId'],
	removeOfflineEffect: ['kind', 'sessionId', 'revision', 'trackId', 'slotId'],
	setTrackMix: ['kind', 'sessionId', 'revision', 'trackId', 'gainDb', 'pan', 'muted', 'solo'],
	import: ['kind', 'sessionId', 'revision', 'trackId', 'start'],
	trim: ['kind', 'sessionId', 'revision', 'clipId', 'start', 'end'],
	split: ['kind', 'sessionId', 'revision', 'clipId', 'frame'],
	moveClip: ['kind', 'sessionId', 'revision', 'clipId', 'trackId', 'start'],
	duplicateClip: ['kind', 'sessionId', 'revision', 'clipId', 'trackId', 'start'],
	deleteClip: ['kind', 'sessionId', 'revision', 'clipId'],
	deleteRange: rangeFields,
	copyRange: rangeFields,
	cutRange: rangeFields,
	pasteRange: ['kind', 'sessionId', 'revision', 'mode', 'trackId', 'start'],
	undo: ['kind', 'sessionId', 'revision'],
	redo: ['kind', 'sessionId', 'revision'],
	save: ['kind', 'sessionId', 'revision'],
	render: ['kind', 'sessionId', 'revision'],
	archive: ['kind', 'sessionId', 'revision'],
	audioHosts: ['kind', 'sessionId'],
	audioDevices: ['kind', 'sessionId', 'hostId'],
	setAudioSetup: ['kind', 'sessionId', ...tracktionAudioSetupFields],
	transportStatus: ['kind', 'sessionId'],
	prepareOutput: ['kind', 'sessionId'],
	play: ['kind', 'sessionId', 'frame'],
	stop: ['kind', 'sessionId'],
	seek: ['kind', 'sessionId', 'frame'],
	setLoop: ['kind', 'sessionId', 'enabled', 'start', 'end'],
	startRecording: ['kind', 'sessionId', 'revision', 'trackId', 'frame'],
	finishRecording: ['kind', 'sessionId', 'revision', 'discard'],
	close: ['kind', 'sessionId'],
} as const satisfies Record<TracktionProjectCommand['kind'], readonly string[]>;

export function readTracktionProjectRequest(value: unknown): TracktionProjectCommand {
	if (!value || typeof value !== 'object') throw new TypeError('Tracktion requires one project command.');
	const kind = readClosedDomainField(value as Readonly<Record<string, unknown>>, 'kind', 'Tracktion request');
	if (typeof kind !== 'string' || !Object.hasOwn(fields, kind)) {
		throw new TypeError('The Tracktion project command is unsupported.');
	}
	const rangedRender = kind === 'render' && (Object.hasOwn(value, 'start') || Object.hasOwn(value, 'end'));
	const request = readClosedDomainRecord(value, 'Tracktion request', rangedRender ? renderRangeFields : fields[kind as keyof typeof fields]);

	if ('sessionId' in request && (typeof request.sessionId !== 'string' || !SESSION_ID.test(request.sessionId))) {
		throw new TypeError('Invalid Tracktion session handle.');
	}
	if (kind === 'setAudioSetup') {
		readTracktionAudioSetup(request);
		return request as TracktionProjectCommand;
	}
	if (kind === 'audioDevices') {
		readTracktionAudioDeviceId(request.hostId, false);
		return request as TracktionProjectCommand;
	}
	const range = kind === 'deleteRange' || kind === 'copyRange' || kind === 'cutRange';
	if (range) {
		const mode = request.mode;
		if ((mode !== 'leaveGap' && mode !== 'perClip' && mode !== 'track' && mode !== 'allTracks')
			|| (mode === 'allTracks') !== (request.trackId === null)) {
			throw new TypeError('Invalid Tracktion range delete mode or track scope.');
		}
	}
	if (kind === 'pasteRange' && !['overlap', 'insertTracks', 'insertAll'].some((mode) => mode === request.mode)) {
		throw new TypeError('Invalid Tracktion paste mode.');
	}
	if ('parameter' in request && !isTracktionAutomationParameter(request.parameter)) {
		throw new TypeError('Invalid Tracktion automation parameter.');
	}
	if (kind === 'setAutomationPoint' && (!isTracktionAutomationParameter(request.parameter)
		|| !isTracktionAutomationValue(request.value, TRACKTION_AUTOMATION_RANGES[request.parameter])
		|| !isTracktionAutomationValue(request.curve, [-1, 1]))) {
		throw new RangeError('The Tracktion automation value is out of range.');
	}

	for (const [key, field] of Object.entries(request)) {
		if (key === 'kind' || key === 'sessionId' || key === 'parameter') continue;
		if (kind === 'setAutomationPoint' && (key === 'value' || key === 'curve' || (key === 'index' && field === null))) continue;
		if (((range || kind === 'pasteRange') && key === 'mode') || (range && key === 'trackId' && field === null)) continue;
		if (key === 'clipId' || key === 'trackId' || key === 'slotId') {
			if (typeof field !== 'string' || !ITEM_ID.test(field) || BigInt(field) > 18_446_744_073_709_551_615n) {
				throw new TypeError('Invalid Tracktion item ID.');
			}
		} else if (key === 'installationId') {
			if (typeof field !== 'string' || !/^i[a-f0-9]{15}$/u.test(field)) throw new TypeError('Invalid Tracktion installation ID.');
		} else if (key === 'name') {
			if (typeof field !== 'string' || !field.trim() || Buffer.byteLength(field) > 128 || field.includes('\0')) {
				throw new TypeError('Invalid Tracktion track name.');
			}
		} else if (key === 'enabled' || key === 'discard' || key === 'muted' || key === 'solo') {
			if (typeof field !== 'boolean') throw new TypeError('The Tracktion toggle must be a boolean.');
		} else if (key === 'gainDb' || key === 'pan') {
			const low = key === 'gainDb' ? -100 : -1;
			const high = key === 'gainDb' ? 6 : 1;
			if (typeof field !== 'number' || !Number.isFinite(field) || field < low || field > high) {
				throw new RangeError('The Tracktion mixer value is out of range.');
			}
		} else if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) {
			throw new TypeError('Tracktion requires a nonnegative safe integer.');
		}
	}
	if (kind === 'create' && (Number(request.sampleRate) < 8_000 || Number(request.sampleRate) > 192_000)) {
		throw new TypeError('Invalid Tracktion sample rate.');
	}
	if ((range || rangedRender || kind === 'trim' || kind === 'setLoop') && Number(request.start) >= Number(request.end)) {
		throw new RangeError('The Tracktion range is empty.');
	}
	return request as TracktionProjectCommand;
}
