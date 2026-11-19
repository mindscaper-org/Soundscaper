/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionProcessIdentity } from './motionscaper-sustained-process.ts';

/** Ownership metadata for one application, separate from the workload's concurrent-process limit. */
export class MotionSustainedProcessCustody {
	#previous: readonly MotionProcessIdentity[] = Object.freeze([]);
	#failure: Error | undefined; #terminalStored = false; #closing = false;
	#tail = Promise.resolve(); #queued = 0; #active = false;
	readonly maximum: number; readonly maximumBatch: number;
	constructor(maximum = 4096, maximumBatch = 64) {
		if (![maximum, maximumBatch].every(value => Number.isSafeInteger(value) && value > 0) || maximumBatch > 64) throw new Error('Invalid Motion process custody admission.');
		this.maximum = maximum; this.maximumBatch = maximumBatch;
	}
	identities(): readonly MotionProcessIdentity[] { return this.#previous; }
	failure(): Error | undefined { return this.#failure; }
	state() { return { closing: this.#closing, pending: this.#queued, failed: this.#failure ? String(this.#failure) : null,
		futureBirths: this.#failure || this.#closing ? 'unobserved' as const : 'observation-active' as const }; }
	retain(values: readonly MotionProcessIdentity[]): void {
		// Production discovery already admits at most 64 current processes. The complete
		// first overflow batch is additional cleanup custody, never a truncated history.
		if (this.#failure && (!this.#active || this.#terminalStored)) throw this.#failure;
		const all = new Map(this.#previous.map(value => [`${value.pid}:${value.startTicks}`, value]));
		let added = 0;
		for (const value of values) {
			const key = `${value.pid}:${value.startTicks}`;
			if (all.has(key)) continue; // Phase histories may re-confirm more than 64 known identities.
			if (++added > this.maximumBatch) {
				// This is outside the reader's existing <=64 census contract, not an
				// admitted overflow snapshot. Keep prior authority and fail closed.
				this.#failure = new Error('Motion unadmitted process snapshot exceeds its existing census admission; additional identities are unknown.');
				this.#terminalStored = true; throw this.#failure;
			}
			all.set(key, value);
		}
		if (added) this.#previous = Object.freeze([...all.values()]);
		if (all.size > this.maximum || this.#failure) {
			this.#failure ??= new Error('Motion cumulative process identity admission exceeded; terminal snapshot retained, future births unknown.');
			this.#terminalStored = true; throw this.#failure;
		}
	}
	#enqueue<T>(read: () => Promise<T>, final: boolean): Promise<T> {
		this.#queued++;
		const work = this.#tail.then(async () => {
			if (this.#failure) throw this.#failure;
			if (this.#closing && !final) throw new Error('Motion process observation admission is closed.');
			this.#active = true;
			try { return await read(); } finally { this.#active = false; }
		}).finally(() => { this.#queued--; });
		this.#tail = work.then(() => undefined, () => undefined);
		return work;
	}
	observe<T>(read: () => Promise<T>): Promise<T> {
		if (this.#failure) return Promise.reject(this.#failure);
		if (this.#closing) return Promise.reject(new Error('Motion process observation admission is closed.'));
		if (this.#queued >= 65) {
			this.#failure = new Error('Motion process census queue admission exceeded; current census retains cleanup custody, future births unknown.');
			return Promise.reject(this.#failure);
		}
		return this.#enqueue(read, false);
	}
	finish<T>(read: () => Promise<T>): Promise<T> {
		if (this.#closing) return Promise.reject(new Error('Motion process observation admission is closed.'));
		this.#closing = true;
		if (this.#failure) return Promise.reject(this.#failure);
		return this.#enqueue(read, true);
	}
}
