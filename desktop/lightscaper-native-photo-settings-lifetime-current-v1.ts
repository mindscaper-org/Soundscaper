/* SPDX-License-Identifier: AGPL-3.0-only */

/** Settings have no cancellation port. Accepted captures and queued SQL drain
 * before connection retirement, including work whose capture reenters close. */
export class LightscaperNativePhotoSettingsLifetimeCurrentV1 {
	readonly #owned = new Set<Promise<unknown>>();
	#tail: Promise<void> = Promise.resolve();
	#closing: Promise<void> | null = null;

	run<Input, Result>(capture: () => Input | Promise<Input>, execute: (input: Input) => Result): Promise<Result> {
		if (this.#closing) return Promise.reject(new Error('Native Photo settings are closed.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
		const previous = this.#tail;
		this.#owned.add(pending);
		// Install the tail before clone/getter/toJSON reflection can reenter.
		this.#tail = pending.then(() => undefined, () => undefined);
		void pending.then(() => { this.#owned.delete(pending); }, () => { this.#owned.delete(pending); });
		let input: Promise<Input>;
		try { input = Promise.resolve(capture()); } catch (error) { input = Promise.reject(error); }
		// A rejected later capture still waits its turn; it cannot let the next
		// request overtake an earlier Blob materialization or synchronous write.
		void input.catch(() => undefined);
		void previous.then(async () => execute(await input)).then(resolve, reject);
		return pending;
	}

	close(retire: () => void): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		// The cached close fence precedes all caller reentry. Failed operations
		// retain their own outcomes; retirement joins both successes and failures.
		void Promise.allSettled([...this.#owned]).then(() => { retire(); }).then(resolve, reject);
		return this.#closing;
	}
}
