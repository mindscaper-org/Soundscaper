/* SPDX-License-Identifier: AGPL-3.0-only */

interface Waiter {
	readonly signal: AbortSignal | undefined;
	readonly resolve: (release: () => void) => void;
	readonly reject: (reason: unknown) => void;
	readonly onAbort: () => void;
}

class CodecQueueFullError extends Error {}

/** Bounded FIFO admission that holds a slot until native work and cleanup settle. */
export class DesktopCodecOperationQueue {
	readonly #maximumActive: number;
	readonly #waiting: Waiter[] = [];
	#active = 0;

	constructor(maximumActive: number) {
		if (!Number.isSafeInteger(maximumActive) || maximumActive < 1 || maximumActive > 4) {
			throw new RangeError('Desktop codec queues admit between one and four active jobs.');
		}
		this.#maximumActive = maximumActive;
	}

	async run<Result>(operation: (queued: boolean) => Promise<Result>, options: Readonly<{
		readonly signal?: AbortSignal;
		readonly refused: (reason: 'busy' | 'cancelled') => Result;
	}>): Promise<Result> {
		const queued = this.#active >= this.#maximumActive;
		let release: () => void;
		try { release = await this.#acquire(options.signal); }
		catch (error) {
			if (options.signal?.aborted) return options.refused('cancelled');
			if (error instanceof CodecQueueFullError) return options.refused('busy');
			throw error;
		}
		try {
			if (options.signal?.aborted) return options.refused('cancelled');
			return await operation(queued);
		} finally { release(); }
	}

	#acquire(signal?: AbortSignal): Promise<() => void> | (() => void) {
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (this.#active < this.#maximumActive) {
			this.#active += 1;
			return this.#releaseOnce();
		}
		if (this.#waiting.length >= 8) return Promise.reject(new CodecQueueFullError('The desktop codec queue is full.'));
		return new Promise<() => void>((resolve, reject) => {
			const waiter: Waiter = { signal, resolve, reject, onAbort: () => {
				const index = this.#waiting.indexOf(waiter);
				if (index < 0) return;
				this.#waiting.splice(index, 1);
				signal?.removeEventListener('abort', waiter.onAbort);
				reject(signal?.reason);
			} };
			this.#waiting.push(waiter);
			signal?.addEventListener('abort', waiter.onAbort, { once: true });
			if (signal?.aborted) waiter.onAbort();
		});
	}

	#releaseOnce(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const next = this.#waiting.shift();
			if (!next) { this.#active -= 1; return; }
			next.signal?.removeEventListener('abort', next.onAbort);
			next.resolve(this.#releaseOnce());
		};
	}
}
