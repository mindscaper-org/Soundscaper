/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';
import type { TracktionProjectCommand } from '../src/soundscaper/tracktion-project-contract.ts';

const SESSION_ID = /^[a-f0-9]{32}$/u;
const ITEM_ID = /^[1-9][0-9]{0,19}$/u;
const fields = {
	create: ['kind', 'sampleRate'],
	open: ['kind'],
	project: ['kind', 'sessionId', 'offset'],
	clips: ['kind', 'sessionId', 'revision', 'trackId', 'offset'],
	addTrack: ['kind', 'sessionId', 'revision', 'name'],
	import: ['kind', 'sessionId', 'revision', 'trackId', 'start'],
	trim: ['kind', 'sessionId', 'revision', 'clipId', 'start', 'end'],
	split: ['kind', 'sessionId', 'revision', 'clipId', 'frame'],
	undo: ['kind', 'sessionId', 'revision'],
	redo: ['kind', 'sessionId', 'revision'],
	save: ['kind', 'sessionId', 'revision'],
	render: ['kind', 'sessionId', 'revision', 'start', 'end'],
	archive: ['kind', 'sessionId', 'revision'],
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
	const request = readClosedDomainRecord(value, 'Tracktion request', fields[kind as keyof typeof fields]);

	for (const [key, field] of Object.entries(request)) {
		if (key === 'kind') continue;
		if (key === 'sessionId') {
			if (typeof field !== 'string' || !SESSION_ID.test(field)) throw new TypeError('Invalid Tracktion session handle.');
		} else if (key === 'clipId' || key === 'trackId') {
			if (typeof field !== 'string' || !ITEM_ID.test(field) || BigInt(field) > 18_446_744_073_709_551_615n) {
				throw new TypeError('Invalid Tracktion item ID.');
			}
		} else if (key === 'name') {
			if (typeof field !== 'string' || !field.trim() || Buffer.byteLength(field) > 128 || field.includes('\0')) {
				throw new TypeError('Invalid Tracktion track name.');
			}
		} else if (key === 'enabled' || key === 'discard') {
			if (typeof field !== 'boolean') throw new TypeError('The Tracktion toggle must be a boolean.');
		} else if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) {
			throw new TypeError('Tracktion requires a nonnegative safe integer.');
		}
	}
	if (kind === 'create' && (Number(request.sampleRate) < 8_000 || Number(request.sampleRate) > 192_000)) {
		throw new TypeError('Invalid Tracktion sample rate.');
	}
	if ((kind === 'render' || kind === 'trim' || kind === 'setLoop') && Number(request.start) >= Number(request.end)) {
		throw new RangeError('The Tracktion range is empty.');
	}
	return request as TracktionProjectCommand;
}
