/* SPDX-License-Identifier: AGPL-3.0-only */

import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';
import { readSourceWithRecovery, SourceReadConnectionError } from './storage/source-read-recovery.ts';

/** Compatibility name for the default threshold; main-approved reads supply their exact larger bound. */
export const DESKTOP_READ_HARD_LIMIT_BYTES = 512 * 1024 * 1024;

export interface DesktopReadMaterializationDescriptor {
	readonly url: string;
	readonly size: number;
}

export interface DesktopReadResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly headers: Pick<Headers, 'get'>;
	readonly body: ReadableStream<Uint8Array> | null;
}

export type DesktopReadFetch = (
	url: string,
	init: RequestInit,
) => Promise<DesktopReadResponse>;

export interface DesktopReadMaterializationOptions {
	readonly fetch: DesktopReadFetch;
	readonly signal: AbortSignal;
	readonly maximumBytes?: number;
	readonly idleTimeoutMs?: number;
}

/** Settle every read capability without losing the consumer's original failure. */
export async function withDesktopReadCleanup<Result>(
	readIds: readonly string[], release: (id: string) => PromiseLike<unknown> | unknown,
	operation: () => PromiseLike<Result> | Result,
): Promise<Result> {
	let result: { ok: true; value: Result } | { ok: false; error: unknown };
	try { result = { ok: true, value: await operation() }; }
	catch (error) { result = { ok: false, error }; }
	const cleanupResults = await Promise.allSettled(readIds.map(async id => release(id)));
	const cleanupErrors = cleanupResults.filter(entry => entry.status === 'rejected')
		.map((entry): unknown => entry.reason);
	if (!result.ok) {
		if (cleanupErrors.length) {
			throw new AggregateError([result.error, ...cleanupErrors],
				'The desktop read failed and its capability cleanup was incomplete.', { cause: result.error });
		}
		throw result.error;
	}
	if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Desktop read capability cleanup was incomplete.');
	return result.value;
}

export async function materializeDesktopReadBlob(
	descriptor: DesktopReadMaterializationDescriptor,
	options: DesktopReadMaterializationOptions,
): Promise<Blob> {
	assertDescriptor(descriptor);
	assertOptions(options);
	const maximumBytes = options.maximumBytes === undefined
		? DESKTOP_READ_HARD_LIMIT_BYTES
		: nonNegativeSafeInteger(options.maximumBytes, 'Desktop read maximumBytes');
	if (descriptor.size > maximumBytes) {
		throw new RangeError('The desktop read declared size exceeds its maximumBytes.');
	}

	throwIfAborted(options.signal);
	const recovery = { signal: options.signal, attemptTimeoutMs: options.idleTimeoutMs ?? 5_000 };
	const response = await readSourceWithRecovery(async () => {
		try { return await options.fetch(descriptor.url, { cache: 'no-store', credentials: 'omit', signal: options.signal }); }
		catch (error) { options.signal.throwIfAborted(); throw new SourceReadConnectionError(error); }
	}, { ...recovery, discardLateValue: value => { if (value.body) cancelBody(value.body, new DOMException('Media read expired.', 'TimeoutError')); } });
	let body: ReadableStream<Uint8Array> | null = null;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	try {
		if (!response || typeof response !== 'object') {
			throw new TypeError('Desktop file read returned an invalid response.');
		}
		body = response.body;
		throwIfAborted(options.signal);
		if (!response.ok) {
			throw new Error(`Desktop file read failed with status ${response.status || 'unknown'}.`);
		}
		const contentLength = parseContentLength(response.headers);
		if (contentLength !== descriptor.size) {
			throw new Error('Desktop file read Content-Length does not match the declared size.');
		}
		if (!body || typeof body.getReader !== 'function') {
			throw new Error('Desktop file read response requires a readable body.');
		}
		reader = body.getReader();
		const retainedParts: Uint8Array<ArrayBuffer>[] = [];
		let receivedBytes = 0;
		while (true) {
			throwIfAborted(options.signal);
			const currentReader = reader;
			const result = await readSourceWithRecovery(() => currentReader.read(), { ...recovery, maximumAttempts: 1 });
			throwIfAborted(options.signal);
			if (result.done) break;
			const chunk = result.value;
			if (!(chunk instanceof Uint8Array)) {
				throw new TypeError('Desktop file read returned a non-byte stream chunk.');
			}
			if (chunk.byteLength > descriptor.size - receivedBytes) {
				throw new Error('Desktop file read actual bytes exceed the declared size.');
			}
			receivedBytes += chunk.byteLength;
			retainBoundedCopies(retainedParts, chunk);
		}
		if (receivedBytes !== descriptor.size) {
			throw new Error('Desktop file read actual bytes do not match the declared size.');
		}
		throwIfAborted(options.signal);
		const blob = new Blob(retainedParts);
		if (blob.size !== descriptor.size) {
			throw new Error('Desktop file read Blob does not match the declared size.');
		}
		throwIfAborted(options.signal);
		return blob;
	} catch (error) {
		if (reader) cancelReader(reader, error);
		else if (body) cancelBody(body, error);
		throw error;
	}
}

function assertDescriptor(
	descriptor: DesktopReadMaterializationDescriptor,
): asserts descriptor is DesktopReadMaterializationDescriptor {
	if (!descriptor || typeof descriptor !== 'object') {
		throw new TypeError('A desktop read descriptor is required.');
	}
	if (typeof descriptor.url !== 'string' || descriptor.url.length === 0) {
		throw new TypeError('A desktop read descriptor requires a URL.');
	}
	nonNegativeSafeInteger(descriptor.size, 'Desktop read declared size');
}

function assertOptions(
	options: DesktopReadMaterializationOptions,
): asserts options is DesktopReadMaterializationOptions {
	if (!options || typeof options !== 'object' || typeof options.fetch !== 'function') {
		throw new TypeError('Desktop read materialization requires a fetch implementation.');
	}
	const signal = options.signal;
	if (!signal || typeof signal !== 'object'
		|| typeof signal.addEventListener !== 'function'
		|| typeof signal.removeEventListener !== 'function') {
		throw new TypeError('Desktop read materialization requires an AbortSignal.');
	}
}

function nonNegativeSafeInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function parseContentLength(headers: Pick<Headers, 'get'>): number {
	const value = headers?.get?.('Content-Length');
	if (value === null || value === undefined || !/^\d+$/u.test(value)) {
		throw new Error('Desktop file read requires an exact Content-Length.');
	}
	const contentLength = Number(value);
	if (!Number.isSafeInteger(contentLength)) {
		throw new Error('Desktop file read requires a safe Content-Length.');
	}
	return contentLength;
}

function retainBoundedCopies(
	parts: Uint8Array<ArrayBuffer>[],
	chunk: Uint8Array,
): void {
	for (let offset = 0; offset < chunk.byteLength; offset += PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes) {
		const length = Math.min(
			PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes,
			chunk.byteLength - offset,
		);
		const retained = new Uint8Array(length);
		retained.set(chunk.subarray(offset, offset + length));
		parts.push(retained);
	}
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason;
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): void {
	try {
		void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
	} catch {
		// Cancellation is best-effort cleanup and must not replace the primary failure.
	}
}

function cancelBody(body: ReadableStream<Uint8Array>, reason: unknown): void {
	try {
		void Promise.resolve(body.cancel(reason)).catch(() => undefined);
	} catch {
		// Cancellation is best-effort cleanup and must not replace the primary failure.
	}
}
