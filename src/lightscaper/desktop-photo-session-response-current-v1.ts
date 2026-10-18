/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';

export interface DesktopPhotoSessionFailureCurrentV1 {
	readonly name: string;
	readonly message: string;
	readonly code?: string;
}
export const DESKTOP_PHOTO_SESSION_CONTROL_CHANNELS_CURRENT_V1 = Object.freeze({
	requested: 'lightscaper:v1:photo-session:local-retirement',
	completed: 'lightscaper:v1:photo-session:local-retirement-completed',
});
export interface DesktopPhotoSessionControlCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'stop' | 'retire';
	readonly openId: string;
	readonly retirementId: string;
}

/** Bounded public failure facts only. Main object identity, arbitrary causes
 * and local opaque cancellation reasons never enter a cross-process DTO. */
export function captureDesktopPhotoSessionFailureCurrentV1(value: unknown): Readonly<DesktopPhotoSessionFailureCurrentV1> {
	try {
		if (!(value instanceof Error) && !(value instanceof DOMException)) return Object.freeze({ name: 'Error', message: 'Native Photo operation failed.' });
		const name = typeof value.name === 'string' ? value.name.slice(0, 128) : 'Error';
		const message = typeof value.message === 'string' ? value.message.slice(0, 2048) : 'Native Photo operation failed.';
		const descriptor = Object.getOwnPropertyDescriptor(value, 'code');
		const code: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		return Object.freeze({ name, message, ...(typeof code === 'string' ? { code: code.slice(0, 128) } : {}) });
	} catch { return Object.freeze({ name: 'Error', message: 'Native Photo operation failed.' }); }
}

export function readDesktopPhotoSessionFailureCurrentV1(value: unknown): Error | DOMException {
	const input = record(value, 'desktop Photo failure', ['name', 'message', 'code'], ['name', 'message']);
	const name = text(field(input, 'name', 'desktop Photo failure'), 128), message = text(field(input, 'message', 'desktop Photo failure'), 2048);
	const code = Object.hasOwn(input, 'code') ? text(field(input, 'code', 'desktop Photo failure'), 128) : undefined;
	let failure: Error | DOMException;
	if (name === 'AbortError') failure = new DOMException(message, name);
	else if (name === 'TypeError') failure = new TypeError(message);
	else if (name === 'RangeError') failure = new RangeError(message);
	else { failure = new Error(message); failure.name = name; }
	if (code !== undefined) Object.defineProperty(failure, 'code', { value: code, enumerable: true });
	return failure;
}

export function readDesktopPhotoSessionResponseCurrentV1(value: unknown): unknown {
	const input = record(value, 'desktop Photo response', ['schemaVersion', 'ok', 'value', 'error'], ['schemaVersion', 'ok']);
	if (field(input, 'schemaVersion', 'desktop Photo response') !== 1) throw new TypeError('Unsupported desktop Photo response.');
	if (field(input, 'ok', 'desktop Photo response') === true && Object.hasOwn(input, 'value') && !Object.hasOwn(input, 'error')) return field(input, 'value', 'desktop Photo response');
	if (field(input, 'ok', 'desktop Photo response') === false && Object.hasOwn(input, 'error') && !Object.hasOwn(input, 'value')) throw readDesktopPhotoSessionFailureCurrentV1(field(input, 'error', 'desktop Photo response'));
	throw new TypeError('Invalid desktop Photo response.');
}

export function readDesktopPhotoSessionControlCurrentV1(value: unknown): Readonly<DesktopPhotoSessionControlCurrentV1> {
	const input = record(value, 'desktop Photo local control', ['schemaVersion', 'kind', 'openId', 'retirementId']);
	const kind = field(input, 'kind', 'desktop Photo local control');
	if (field(input, 'schemaVersion', 'desktop Photo local control') !== 1 || (kind !== 'stop' && kind !== 'retire')) throw new TypeError('Invalid desktop Photo local control.');
	return Object.freeze({ schemaVersion: 1, kind, openId: token(field(input, 'openId', 'desktop Photo local control')), retirementId: token(field(input, 'retirementId', 'desktop Photo local control')) });
}
function text(value: unknown, maximum: number): string { if (typeof value !== 'string' || value.length > maximum) throw new TypeError('Invalid desktop Photo failure fact.'); return value; }
function token(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Invalid desktop Photo local control identity.'); return value; }
