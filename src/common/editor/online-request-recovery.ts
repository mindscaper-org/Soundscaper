/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../foundation/abort-race.ts';
import { withUploadValidationFailure } from './upload-validation-failure.ts';

export interface OnlineRequestRecoveryOptions {
	readonly maximumAttempts?: number;
	readonly requestTimeoutMs?: number;
	readonly idleTimeoutMs?: number;
	readonly offlineWaitMs?: number;
	readonly retryDelayMs?: number;
	readonly bufferResponses?: boolean;
	readonly maximumBufferedBytes?: number;
	readonly isOnline?: () => boolean;
	readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
	readonly log?: (message: string) => void;
}

class OfflineWaitExpired extends Error {
	constructor() { super('The device is offline. Reconnect and retry the operation.'); this.name = 'TimeoutError'; }
}

class OnlineReadFailure extends Error {
	constructor(cause: unknown, readonly retryDelayMs?: number, readonly responseFailure?: Error) {
		super('The online response was interrupted.', { cause }); this.name = 'OnlineReadFailure';
	}
}

/** A sent mutation can have committed even when its acknowledgement was lost. */
export class OnlineMutationOutcomeUnknownError extends Error {
	readonly outcome = 'unknown';
	constructor(cause: unknown, readonly status?: number) {
		super('The connection was lost while sending. The server may have received the operation; refresh its state before retrying.', { cause });
		this.name = 'OnlineMutationOutcomeUnknownError';
		withUploadValidationFailure(this, 'outcomeUnknown');
	}
}

/** Preserve definitive rejections; uncertain success or gateway failure needs reconciliation. */
export async function readOnlineMutationAcknowledgment<Value>(response: Response, read: () => Promise<Value>): Promise<Value> {
	if ([408, 500, 502, 503, 504].includes(response.status)) {
		void response.body?.cancel().catch(() => undefined);
		throw new OnlineMutationOutcomeUnknownError(new Error(`HTTP ${response.status}`), response.status);
	}
	try { return await read(); }
	catch (error) {
		if (response.ok) throw new OnlineMutationOutcomeUnknownError(error, response.status);
		throw error;
	}
}

/** Retry only reads whose bytes have not yet been published into the project. */
export async function recoverOnlineRead<Value>(
	read: () => Promise<Value>, signal?: AbortSignal, options: OnlineRequestRecoveryOptions = {},
): Promise<Value> {
	const attempts = options.maximumAttempts ?? 3;
	for (let attempt = 0; ; attempt += 1) {
		signal?.throwIfAborted();
		try { const value = await read(); if (attempt > 0) log(options, 'Online read recovered.'); return value; }
		catch (error) {
			signal?.throwIfAborted();
			if (attempt + 1 >= attempts || !retryable(error)) {
				throw error instanceof OnlineReadFailure && error.responseFailure ? error.responseFailure : error;
			}
			log(options, 'Online read interrupted; retrying.');
			await (options.wait ?? wait)(error instanceof OnlineReadFailure && error.retryDelayMs !== undefined
				? error.retryDelayMs : (options.retryDelayMs ?? 250) * 2 ** attempt, signal);
		}
	}
}

/** Classify an authoritative HTTP response without retrying validation or authentication errors. */
export function onlineReadResponseError(response: Response, failure: Error): Error {
	if (![408, 429, 500, 502, 503, 504].includes(response.status)) return failure;
	const error = new OnlineReadFailure(failure, retryAfter(response), failure);
	error.message = failure.message;
	return error;
}

/** Offline mutations wait before sending; a sent mutation is never replayed automatically. */
export function createRecoveringOnlineFetch(
	fetchRequest: typeof fetch, options: OnlineRequestRecoveryOptions = {},
): typeof fetch {
	return async (input, init = {}) => {
		const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
		const signal = init.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
		let sent = 0;
		let receivedStatus: number | undefined;
		const operation = async (): Promise<Response> => {
			await waitUntilOnline(signal, options);
			sent += 1;
			const response = await fetchAttempt(fetchRequest, input, init, signal, options, method);
			receivedStatus = response.status;
			if (sent < (options.maximumAttempts ?? 3) && ['GET', 'HEAD'].includes(method) && [408, 429, 500, 502, 503, 504].includes(response.status)) {
				void response.body?.cancel().catch(() => undefined);
				throw new OnlineReadFailure(new Error(`HTTP ${response.status}`), retryAfter(response));
			}
			const read = () => options.bufferResponses === false ? Promise.resolve(response) : bufferControlResponse(response, options.maximumBufferedBytes ?? 1_048_576);
			return ['GET', 'HEAD'].includes(method) ? read() : readOnlineMutationAcknowledgment(response, read);
		};
		if (['GET', 'HEAD'].includes(method)) return recoverOnlineRead(operation, signal, options);
		try { return await operation(); }
		catch (error) {
			signal?.throwIfAborted();
			if (sent > 0 && (receivedStatus === undefined || receivedStatus >= 200 && receivedStatus < 300) && (error instanceof TypeError || retryable(error))) {
				throw new OnlineMutationOutcomeUnknownError(error);
			}
			throw error;
		}
	};
}

async function waitUntilOnline(signal: AbortSignal | undefined, options: OnlineRequestRecoveryOptions): Promise<void> {
	const isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false);
	if (isOnline()) return;
	log(options, 'Connection unavailable; waiting to reconnect.');
	const expires = Date.now() + (options.offlineWaitMs ?? 30_000);
	while (!isOnline()) {
		signal?.throwIfAborted();
		const remaining = expires - Date.now();
		if (remaining <= 0) throw new OfflineWaitExpired();
		await (options.wait ?? wait)(Math.min(250, remaining), signal);
	}
	log(options, 'Connection restored; continuing the operation.');
}

async function fetchAttempt(
	fetchRequest: typeof fetch, input: RequestInfo | URL, init: RequestInit,
	signal: AbortSignal | undefined, options: OnlineRequestRecoveryOptions, method: string,
): Promise<Response> {
	const controller = new AbortController();
	const abort = (): void => controller.abort(signal?.reason);
	if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
	let timer = setTimeout(() => controller.abort(timeout('The online request did not respond in time.')),
		options.requestTimeoutMs ?? (['GET', 'HEAD'].includes(method) ? 15_000 : 600_000));
	const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
	try {
		const response = await raceAbortableRead(() => {
			const pending = fetchRequest(input, { ...init, signal: controller.signal });
			void pending.then(value => {
				if (controller.signal.aborted) void value.body?.cancel().catch(() => undefined);
			}, () => undefined);
			return pending;
		}, controller.signal);
		clearTimeout(timer);
		if (!response.body) { cleanup(); return response; }
		if ([204, 205, 304].includes(response.status)) {
			cleanup();
			void response.body.cancel().catch(() => undefined);
			return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
		}
		const reader = response.body.getReader();
		let finished = false;
		let receivedBytes = 0;
		const length = response.headers.get('Content-Length');
		const expectedBytes = !response.headers.has('Content-Encoding') && length !== null && /^\d+$/u.test(length)
			&& Number.isSafeInteger(Number(length)) ? Number(length) : null;
		let output: ReadableStreamDefaultController<Uint8Array>;
		const finish = (): void => { finished = true; cleanup(); controller.signal.removeEventListener('abort', onAbort); };
		const retire = (reason: unknown): void => { void reader.cancel(reason).catch(() => undefined); };
		const onAbort = (): void => {
			if (finished) return;
			finish(); output.error(controller.signal.reason); retire(controller.signal.reason);
		};
		const refresh = (): void => {
			clearTimeout(timer);
			timer = setTimeout(() => controller.abort(timeout('The online transfer stopped responding. Retry when the connection returns.')), options.idleTimeoutMs ?? 15_000);
		};
		const body = new ReadableStream<Uint8Array>({
			start(value) { output = value; controller.signal.addEventListener('abort', onAbort, { once: true }); refresh(); if (controller.signal.aborted) onAbort(); },
			async pull(value) {
				try {
					const next = await raceAbortableRead(() => reader.read(), controller.signal);
					if (finished) return;
					if (next.done) {
						if (expectedBytes !== null && receivedBytes !== expectedBytes) throw new OnlineReadFailure(new Error('The response byte length was incomplete.'));
						finish(); value.close(); reader.releaseLock();
					} else { receivedBytes += next.value.byteLength; refresh(); value.enqueue(next.value); }
				} catch (error) {
					if (finished) return;
					finish(); const failure = controller.signal.aborted ? controller.signal.reason : new OnlineReadFailure(error);
					value.error(failure); retire(failure);
				}
			},
			cancel(reason) { if (!finished) { finish(); controller.abort(reason); retire(reason); } },
		}, { highWaterMark: 0 });
		return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
	} catch (error) {
		cleanup(); signal?.throwIfAborted();
		if (error instanceof TypeError && ['GET', 'HEAD'].includes(method)) throw new OnlineReadFailure(error);
		throw error;
	}
}

async function bufferControlResponse(response: Response, maximum: number): Promise<Response> {
	if (!response.body) return response;
	const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const next = await reader.read(); if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maximum) throw new RangeError('The online response exceeds its permitted size.');
			chunks.push(new Uint8Array(next.value));
		}
	} catch (error) { void reader.cancel(error).catch(() => undefined); throw error; }
	finally { reader.releaseLock(); }
	return new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
}

function retryable(error: unknown): boolean {
	return !(error instanceof OfflineWaitExpired) && (error instanceof OnlineReadFailure || error instanceof Error && error.name === 'TimeoutError');
}
function retryAfter(response: Response): number | undefined {
	const value = response.headers.get('Retry-After');
	if (value === null) return undefined;
	const milliseconds = /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
	return Number.isFinite(milliseconds) ? Math.max(0, Math.min(30_000, milliseconds)) : undefined;
}
function timeout(message: string): Error { const error = new Error(message); error.name = 'TimeoutError'; return error; }
function log(options: OnlineRequestRecoveryOptions, message: string): void {
	try { (options.log ?? (value => globalThis.console?.info(value)))(message); } catch { /* Logging cannot interrupt recovery. */ }
}
function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const abort = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
		const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
		signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
	});
}
