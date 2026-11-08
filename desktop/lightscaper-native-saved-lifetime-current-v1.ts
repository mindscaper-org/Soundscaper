/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoSmartCollectionArchiveCaptureV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { PhotoCatalogClosedError } from '../src/lightscaper/catalog/repository-types.ts';

const NativeController = AbortController, nativeAbort = NativeController.prototype.abort;
const nativeSignal = Object.getOwnPropertyDescriptor(NativeController.prototype, 'signal')!.get!;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
interface ArchiveOwner {
	readonly capture: Promise<PhotoSmartCollectionArchiveCaptureV1>;
	readonly retire: () => Promise<void>;
}
interface Entry { readonly initialized: Promise<ArchiveOwner>; readonly dispose: () => void }

/** Main-private lifetime for yielding audits and escaped archive readers.
 * Public admission stays with the queued owner. Every link uses captured native
 * signal behavior; an opaque reason is forwarded without inspecting it. */
export class LightscaperNativeSavedLifetimeCurrentV1 {
	readonly #shutdown = new NativeController();
	readonly #captures = new Set<Entry>();
	readonly #retirements = new Map<Entry, Promise<void>>();
	get shutdownSignal(): AbortSignal { return Reflect.apply(nativeSignal, this.#shutdown, []) as AbortSignal; }
	stop(): void { nativeAbort.call(this.#shutdown, new PhotoCatalogClosedError()); }
	async run<T>(signal: AbortSignal | undefined, run: (privateSignal: AbortSignal) => T | Promise<T>): Promise<T> {
		const link = this.#link(signal);
		try { return await run(link.signal); }
		finally { link.dispose(); }
		// No post-return abort check: a durable SQL acknowledgement owns success.
	}
	capture(signal: AbortSignal | undefined, initialize: (privateSignal: AbortSignal) => ArchiveOwner): Promise<PhotoSmartCollectionArchiveCaptureV1> {
		const link = this.#link(signal);
		// Register before invoking even the internal factory. Its synchronous
		// handle then owns initialization, idle next and final verification.
		const entry: Entry = { initialized: Promise.resolve().then(() => initialize(link.signal)), dispose: link.dispose };
		this.#captures.add(entry);
		return entry.initialized.then(owner => owner.capture).then(capture => this.#wrap(entry, capture)).catch(async (error: unknown) => {
			try { await this.#retire(entry); }
			catch (cleanup) {
				if (cleanup !== error) throw new AggregateError([error, cleanup], 'Saved capture initialization and retirement failed.', { cause: cleanup });
			}
			throw error;
		});
	}
	async retire(): Promise<void> {
		const results = await Promise.allSettled([...this.#captures].map(entry => this.#retire(entry)));
		const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (failures.length) throw new AggregateError(failures, 'Native saved archive retirement failed.');
	}
	#wrap(entry: Entry, capture: PhotoSmartCollectionArchiveCaptureV1): PhotoSmartCollectionArchiveCaptureV1 {
		const retire = () => this.#retire(entry);
		return Object.freeze({ context: capture.context, definitions: Object.freeze({
			[Symbol.asyncIterator]() {
				const iterator = capture.definitions[Symbol.asyncIterator]();
				return {
					next: () => iterator.next(),
					async return() {
						const result = iterator.return ? await iterator.return() : { done: true as const, value: undefined };
						await retire(); return result;
					}
				};
			}
		}), verify: async () => {
			await capture.verify();
			// Join the source operation before retirement; it must never wait on
			// a wrapper that is itself awaiting the source's active promise.
			await retire();
		} });
	}
	#retire(entry: Entry): Promise<void> {
		let retiring = this.#retirements.get(entry);
		if (!retiring) {
			retiring = entry.initialized.then(owner => owner.retire(), () => undefined).then(() => {
				entry.dispose(); this.#captures.delete(entry); this.#retirements.delete(entry);
			});
			this.#retirements.set(entry, retiring);
		}
		return retiring;
	}
	#link(caller: AbortSignal | undefined): Readonly<{ signal: AbortSignal; dispose: () => void }> {
		const controller = new NativeController(), shutdown = Reflect.apply(nativeSignal, this.#shutdown, []) as AbortSignal;
		const sources = caller === undefined ? [shutdown] : [caller, shutdown];
		const links = sources.map(source => ({ source, forward: (): void => {
			const reason: unknown = Reflect.apply(nativeReason, source, []); nativeAbort.call(controller, reason);
		} }));
		for (const link of links) {
			Reflect.apply(nativeAdd, link.source, ['abort', link.forward, { once: true }]);
			if (Reflect.apply(nativeAborted, link.source, []) === true) link.forward();
		}
		return Object.freeze({ signal: Reflect.apply(nativeSignal, controller, []) as AbortSignal,
			dispose: (): void => { for (const link of links) Reflect.apply(nativeRemove, link.source, ['abort', link.forward]); } });
	}
}
