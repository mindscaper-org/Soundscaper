/* SPDX-License-Identifier: AGPL-3.0-only */

/** A transport failure, distinct from a changed identity or invalid media bytes. */
export class SourceReadConnectionError extends Error {
	constructor(cause?: unknown, message = 'The media source connection was interrupted.') {
		super(message, { cause });
		this.name = 'SourceReadConnectionError';
	}
}

export interface SourceReadRecoveryOptions<Value = unknown> {
	readonly signal?: AbortSignal;
	readonly maximumAttempts?: number;
	readonly attemptTimeoutMs?: number;
	readonly retryDelayMs?: number;
	readonly log?: (message: string) => void;
	readonly discardLateValue?: (value: Value) => PromiseLike<unknown> | unknown;
}

const TRANSIENT_IO_CODES = new Set([
	'ENOENT', 'EIO', 'ESTALE', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
	'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTCONN', 'EPIPE', 'EAGAIN',
]);

/** Retry only an immutable read. Each attempt and its backoff remain caller-cancellable. */
export async function readSourceWithRecovery<Value>(
	read: (signal: AbortSignal, progress?: () => void) => PromiseLike<Value> | Value,
	options: SourceReadRecoveryOptions<Value> = {},
): Promise<Value> {
	const maximumAttempts = positiveInteger(options.maximumAttempts ?? 3, 'Source read maximum attempts');
	const timeoutMs = positiveInteger(options.attemptTimeoutMs ?? 5_000, 'Source read timeout');
	const retryDelayMs = options.retryDelayMs ?? 100;
	if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new RangeError('Source read retry delay must be non-negative.');
	const log = (message: string): void => {
		try { (options.log ?? defaultLog)(message); } catch { /* Diagnostics cannot interrupt source recovery. */ }
	};
	for (let attempt = 1; ; attempt += 1) {
		options.signal?.throwIfAborted();
		try {
			const result = await boundedRead(read, timeoutMs, options.signal, options.discardLateValue);
			try { options.signal?.throwIfAborted(); }
			catch (error) { discardReadValue(result, options.discardLateValue); throw error; }
			if (attempt > 1) log('The media source connection recovered.');
			return result;
		} catch (error) {
			options.signal?.throwIfAborted();
			if (attempt >= maximumAttempts || !isTransientSourceReadError(error)) throw error;
			log(`The media source connection was interrupted; retrying (${attempt + 1}/${maximumAttempts}).`);
			await wait(retryDelayMs * attempt, options.signal);
		}
	}
}

function isTransientSourceReadError(error: unknown): boolean {
	if (error instanceof SourceReadConnectionError) return true;
	if (!error || typeof error !== 'object') return false;
	const candidate = error as Readonly<{ name?: unknown; code?: unknown }>;
	return candidate.name === 'TimeoutError' || candidate.name === 'NetworkError'
		|| typeof candidate.code === 'string' && TRANSIENT_IO_CODES.has(candidate.code);
}

function boundedRead<Value>(
	read: (signal: AbortSignal, progress?: () => void) => PromiseLike<Value> | Value,
	timeoutMs: number,
	parent?: AbortSignal,
	discardLateValue?: (value: Value) => PromiseLike<unknown> | unknown,
): Promise<Value> {
	const controller = new AbortController();
	const relayAbort = (): void => controller.abort(parent?.reason);
	parent?.addEventListener('abort', relayAbort, { once: true });
	if (parent?.aborted) relayAbort();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let active = true;
	const progress = (): void => {
		if (!active || controller.signal.aborted) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			controller.abort(new DOMException('The media source did not respond in time.', 'TimeoutError'));
		}, timeoutMs);
	};
	let removeAbortListener = (): void => undefined;
	const reading = new Promise<Value>((resolve, reject) => {
		const aborted = (): void => reject(controller.signal.reason);
		controller.signal.addEventListener('abort', aborted, { once: true });
		removeAbortListener = () => controller.signal.removeEventListener('abort', aborted);
		progress();
		if (controller.signal.aborted) aborted();
		else {
			// Observe both branches even when an ignored abort settles this request first.
			void Promise.resolve().then(() => read(controller.signal, progress)).then(value => {
				if (!controller.signal.aborted) { resolve(value); return; }
				discardReadValue(value, discardLateValue);
			}, reject);
		}
	});
	return reading.catch((error: unknown) => {
		if (!controller.signal.aborted) controller.abort(error);
		throw error;
	}).finally(() => {
		active = false;
		clearTimeout(timer);
		removeAbortListener();
		parent?.removeEventListener('abort', relayAbort);
	});
}

function discardReadValue<Value>(value: Value, discard?: (value: Value) => PromiseLike<unknown> | unknown): void {
	if (!discard) return;
	void Promise.resolve().then(() => discard(value)).catch(() => {
		try { globalThis.console?.warn('An abandoned media source read could not release its transport.'); }
		catch { /* Logging cannot turn cleanup failure into an unhandled rejection. */ }
	});
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	if (milliseconds === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const abort = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
		const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
		signal?.addEventListener('abort', abort, { once: true });
	});
}

function positiveInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer.`);
	return value;
}

function defaultLog(message: string): void { globalThis.console?.info(message); }
