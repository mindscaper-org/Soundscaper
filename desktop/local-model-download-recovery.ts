/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../src/common/foundation/abort-race.ts';

export interface LocalModelDownloadRecoveryOptions {
	readonly maxAttempts?: number;
	readonly timeoutMs?: number;
	readonly retryDelayMs?: number;
	readonly log?: (message: string) => void;
}

/** Only connection failures may retry; disk, format and integrity errors remain terminal. */
export class LocalModelConnectionError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'LocalModelConnectionError';
	}
}

export interface LocalModelDownloadConnection {
	readonly signal: AbortSignal;
	read<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value>;
}

export async function recoverLocalModelDownload<Value>(
	operation: (connection: LocalModelDownloadConnection) => Promise<Value>,
	signal: AbortSignal | undefined,
	options: LocalModelDownloadRecoveryOptions = {},
): Promise<Value> {
	const maxAttempts = positiveInteger(options.maxAttempts ?? 4, 'attempt count', 8);
	const timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, 'connection timeout', 600_000);
	const retryDelayMs = options.retryDelayMs ?? 1_000;
	if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) {
		throw new RangeError('The model download retry delay is invalid.');
	}
	const log = (message: string): void => {
		try { (options.log ?? globalThis.console?.warn)?.(message); }
		catch { /* Diagnostics cannot interrupt an installation. */ }
	};
	for (let attempt = 1; ; attempt += 1) {
		signal?.throwIfAborted();
		const controller = new AbortController();
		const abort = (): void => controller.abort(signal?.reason);
		signal?.addEventListener('abort', abort, { once: true });
		try {
			const result = await operation({
				signal: controller.signal,
				async read<Value>(read: () => PromiseLike<Value> | Value): Promise<Value> {
					controller.signal.throwIfAborted();
					const timer = setTimeout(() => controller.abort(
						new LocalModelConnectionError('The local model download connection timed out.'),
					), timeoutMs);
					try {
						return await raceAbortableRead(read, controller.signal, 'immediate');
					} catch (error) {
						controller.signal.throwIfAborted();
						throw new LocalModelConnectionError('The local model download connection was interrupted.', { cause: error });
					} finally { clearTimeout(timer); }
				},
			});
			signal?.throwIfAborted();
			if (attempt > 1) log('The local model download connection recovered.');
			return result;
		} catch (error) {
			controller.abort(error);
			signal?.throwIfAborted();
			if (!(error instanceof LocalModelConnectionError) || attempt >= maxAttempts) throw error;
			log(`The local model download connection was interrupted; retry ${attempt} of ${maxAttempts - 1}.`);
		} finally { signal?.removeEventListener('abort', abort); }
		await retryDelay(Math.min(30_000, retryDelayMs * 2 ** (attempt - 1)), signal);
	}
}

function retryDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return raceAbortableRead(() => new Promise<void>(resolve => {
		const abort = (): void => { clearTimeout(timer); };
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', abort);
			resolve();
		}, milliseconds);
		signal?.addEventListener('abort', abort, { once: true });
	}), signal, 'immediate');
}

function positiveInteger(value: number, label: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(`The model download ${label} is invalid.`);
	}
	return value;
}
