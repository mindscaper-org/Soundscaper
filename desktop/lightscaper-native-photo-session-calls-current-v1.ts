/* SPDX-License-Identifier: AGPL-3.0-only */

/** Accepted calls start synchronously, preserving native Blob/clone capture
 * and COMMIT ACK ownership. The outer lease owns the stop fence; this owner
 * joins actual calls and escaped cleanup without a second publication queue. */
export class LightscaperNativePhotoSessionCallsCurrentV1 {
	readonly #assert: () => void;
	readonly #active = new Set<Promise<unknown>>();
	readonly #retire = new Set<() => Promise<unknown>>();
	#closing: Promise<void> | undefined;
	constructor(assertCurrent: () => void) { this.#assert = assertCurrent; }
	run<Result>(operation: () => Result | PromiseLike<Result>, cleanup = false): Promise<Result> {
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active.add(pending);
		let actual: Promise<Result>;
		try { if (!cleanup) this.#assert(); actual = Promise.resolve(operation()); } catch (error) { actual = Promise.reject(error); }
		void actual.then(value => { this.#active.delete(pending); resolve(value); }, (error: unknown) => { this.#active.delete(pending); reject(error); });
		return pending;
	}
	sync<Result>(operation: () => Result): Result { this.#assert(); return operation(); }
	own(retire: () => Promise<unknown>): () => void { this.#retire.add(retire); return () => { this.#retire.delete(retire); }; }
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		void (async () => {
			// Accepted factories may register an escaped owner only when their
			// actual native opening finishes. Join them before taking inventory.
			while (this.#active.size) await Promise.allSettled([...this.#active]);
			while (this.#retire.size) {
				const results = await Promise.allSettled([...this.#retire].map(async retire => { await retire(); this.#retire.delete(retire); }));
				while (this.#active.size) await Promise.allSettled([...this.#active]);
				const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
				if (failures.length) throw new AggregateError(failures, 'Native Session escaped retirement is unproved.');
			}
		})().then(resolve, reject); return this.#closing;
	}
}
