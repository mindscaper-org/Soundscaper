/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { readDesktopPhotoLibrarySessionHandleCurrentV1, type DesktopPhotoLibrarySessionHandleKindCurrentV1 as Kind } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';

export interface LightscaperNativePhotoSessionHandleOwnerCurrentV1 {
	close(): Promise<void>;
	read?(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
	write?(sequence: number, offset: number, bytes: unknown): Promise<unknown>;
	commit?(): Promise<unknown>;
	next?(): Promise<unknown>;
	verify?(): Promise<void>;
}
interface Entry { readonly id: string; readonly kind: Kind; bytes: number; owner?: LightscaperNativePhotoSessionHandleOwnerCurrentV1; readonly ready: Promise<void>; readyDone(): void; closing?: Promise<void> }
export class LightscaperNativePhotoSessionHandlesCurrentV1 {
	readonly #entries = new Map<string, Entry>();
	#bytes = 0;
	get count(): number { return this.#entries.size; }
	assertCapacity(): void { if (this.#entries.size >= 16) throw new RangeError('Native Session handle capacity is full.'); }
	reserve(kind: Kind, bytes = 0) {
		this.assertCapacity(); this.#admitBytes(bytes);
		let readyDone!: () => void; const ready = new Promise<void>(resolve => { readyDone = resolve; });
		const id = randomBytes(32).toString('hex'), entry: Entry = { id, kind, bytes, ready, readyDone };
		this.#entries.set(id, entry); this.#bytes += bytes;
		const release = () => { if (this.#entries.get(id) === entry) { this.#entries.delete(id); this.#bytes -= entry.bytes; } };
		return Object.freeze({ handle: Object.freeze({ kind, id }),
			charge: (next: number) => { this.#admitBytes(next - entry.bytes); this.#bytes += next - entry.bytes; entry.bytes = next; },
			publish: (owner: LightscaperNativePhotoSessionHandleOwnerCurrentV1) => { entry.owner = owner; readyDone(); },
			abandon: () => { readyDone(); release(); },
			quarantine: (owner: LightscaperNativePhotoSessionHandleOwnerCurrentV1) => { entry.owner = owner; readyDone(); },
		});
	}
	owner(value: unknown, kind: Kind): LightscaperNativePhotoSessionHandleOwnerCurrentV1 {
		const { id } = readDesktopPhotoLibrarySessionHandleCurrentV1(value, kind), entry = this.#entries.get(id);
		if (!entry || entry.kind !== kind || !entry.owner || entry.closing) throw new ReferenceError('Native Session handle is missing, pending or retiring.');
		return entry.owner;
	}
	close(value: unknown, kind: Kind, terminal?: 'verify'): Promise<void> {
		const { id } = readDesktopPhotoLibrarySessionHandleCurrentV1(value, kind), entry = this.#entries.get(id);
		if (!entry) return Promise.resolve();
		if (entry.kind !== kind) return Promise.reject(new TypeError('Native handle purpose differs.'));
		if (entry.closing) return entry.closing;
		entry.closing = Promise.resolve().then(async () => {
			await entry.ready;
			if (entry.owner) { if (terminal === 'verify') { if (!entry.owner.verify) throw new TypeError('Archive verification owner is missing.'); await entry.owner.verify(); } else await entry.owner.close(); }
			if (this.#entries.get(id) === entry) { this.#entries.delete(id); this.#bytes -= entry.bytes; }
		}).catch((failure: unknown) => { if (terminal === 'verify') entry.closing = undefined; throw failure; });
		return entry.closing;
	}
	async closeAll(): Promise<void> {
		const results = await Promise.allSettled([...this.#entries.values()].map(entry => this.close({ kind: entry.kind, id: entry.id }, entry.kind)));
		const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (errors.length) throw new AggregateError(errors, 'Native Session handle retirement is unproved.');
	}
	#admitBytes(bytes: number): void {
		if (!Number.isSafeInteger(bytes) || bytes < 0 || this.#bytes + bytes > 134_217_728) throw new RangeError('Native Session retained body capacity is full.');
	}
}
