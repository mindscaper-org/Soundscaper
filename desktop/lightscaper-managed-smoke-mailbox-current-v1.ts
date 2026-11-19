/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperSmokeCustodyCurrentV1 as Custody } from './lightscaper-managed-smoke-contract-current-v1.ts';
interface Pending { readonly id: number; readonly photoIds: readonly string[]; readonly resolve: (value: Custody) => void; readonly reject: (error: unknown) => void; readonly timer: ReturnType<typeof setTimeout> }
/** Only the statically inventoried smoke IIFE owns this mailbox. It adds no
	* preload/API method. Main returns an independently observed bounded report. */
export class LightscaperManagedSmokeMailboxCurrentV1 {
	readonly #nonce: string;
	#pending: Pending | undefined;
	#sequence = 0;
	#closed = false;
	constructor(nonce: string) { if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new TypeError('Owned smoke nonce required.'); this.#nonce = nonce; }
	request(value: readonly string[]): Promise<Custody> {
		if (this.#closed) return Promise.reject(new Error('Smoke checkpoint mailbox is closed.'));
		if (this.#pending) return Promise.reject(new Error('A smoke custody checkpoint is pending.'));
		if (this.#sequence >= 3) return Promise.reject(new RangeError('Smoke checkpoint inventory exceeded.'));
		if (!Array.isArray(value) || value.length !== 2 || new Set(value).size !== 2 || value.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id))) return Promise.reject(new TypeError('Smoke checkpoint requires exactly two Photo identities.'));
		const photoIds = Object.freeze([...value]), id = ++this.#sequence;
		let resolve!: (result: Custody) => void, reject!: (error: unknown) => void;
		const work = new Promise<Custody>((yes, no) => { resolve = yes; reject = no; });
		const timer = setTimeout(() => { this.reject(id, 'Native smoke custody checkpoint timed out.'); }, 45_000);
		this.#pending = { id, photoIds, resolve, reject, timer };
		console.debug(`LightscaperManagedCustody:${this.#nonce}:${id}`); return work;
	}
	take(): Readonly<{ id: number; photoIds: readonly string[] }> | null { const current = this.#pending; return current ? Object.freeze({ id: current.id, photoIds: current.photoIds }) : null; }
	deliver(id: number, value: Custody): void {
		const current = this.#pending;
		if (!current || current.id !== id || JSON.stringify(value).length > 512 * 1024) throw new TypeError('Smoke custody reply does not own its bounded checkpoint.');
		this.#pending = undefined; clearTimeout(current.timer); current.resolve(value);
	}
	reject(id: number, message: string): void { const current = this.#pending; if (!current || current.id !== id) return; this.#pending = undefined; clearTimeout(current.timer); current.reject(new Error(message.slice(0, 2048))); }
	retire(): void { this.#closed = true; if (this.#pending) this.reject(this.#pending.id, 'Smoke custody checkpoint retired.'); }
}
