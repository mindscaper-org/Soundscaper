/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { MediaAssetWriter, MediaAssetWriteOptions } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { readLightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalStoreCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';
import { LightscaperNativeOriginalStreamCurrentV1 } from './lightscaper-native-original-stream-current-v1.ts';
import { captureLightscaperNativePhotoMediaMetadataCurrentV1 } from './lightscaper-native-photo-media-metadata-current-v1.ts';
import { getLightscaperNativePhotoMediaAssetCurrentV1, installLightscaperNativePhotoMediaStreamAssetCurrentV1 } from './lightscaper-native-photo-media-assets-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

type Options = Readonly<{ signal?: AbortSignal }>;
type Link = ReturnType<typeof link>;
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;

/** Escaped producers have independent retirement promises. They never occupy
 * the media SQL queue while waiting for a caller's next write or commit. */
export class LightscaperNativePhotoMediaWritersCurrentV1 {
	readonly #entries = new Set<Entry>();
	readonly #failures: unknown[] = [];
	readonly #originals: LightscaperNativeOriginalStoreCurrentV1;
	readonly #database: DatabaseSync;
	#closed = false;
	#closing: Promise<void> | null = null;
	constructor(originals: LightscaperNativeOriginalStoreCurrentV1, database: DatabaseSync) {
		this.#originals = originals; this.#database = database;
	}
	begin(sourceId: string, metadata: Readonly<Record<string, unknown>>, options: MediaAssetWriteOptions): Promise<MediaAssetWriter> {
		if (this.#closed) return Promise.reject(new Error('Native Photo media writers are closed.'));
		const entry = new Entry(this.#originals, this.#database); this.#entries.add(entry);
		void entry.retired.then(() => { this.#entries.delete(entry); }, (error: unknown) => { this.#failures.push(error); this.#entries.delete(entry); });
		return entry.begin(sourceId, metadata, options);
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		const completion = deferred<void>(); this.#closing = completion.promise;
		const active = [...this.#entries];
		// Fence/cache before synchronous abort observers can reenter the owner.
		const pending = active.map(entry => entry.retire());
		void Promise.allSettled(pending).then(() => {
			if (this.#failures.length) throw new AggregateError(this.#failures, 'Native Photo streamed writer retirement failed.');
		}).then(completion.resolve, completion.reject);
		return this.#closing;
	}
}

class Entry {
	readonly #originals: LightscaperNativeOriginalStoreCurrentV1;
	readonly #database: DatabaseSync;
	readonly #stop = new NativeController();
	readonly #captured = deferred<void>();
	readonly #retirement = deferred<void>();
	readonly retired = this.#retirement.promise;
	#scope: Link | null = null;
	#stream: LightscaperNativeOriginalStreamCurrentV1 | null = null;
	#state: 'opening' | 'open' | 'committing' | 'retiring' = 'opening';
	#retiring = false;
	#writeWork: Promise<void> | null = null;
	#commitWork: Promise<Readonly<Record<string, unknown>>> | null = null;
	#commitResult: Promise<Readonly<Record<string, unknown>>> | null = null;
	#abortResult: Promise<void> | null = null;
	#failure: unknown;
	#hasFailure = false;
	#cancel: (() => void) | null = null;
	#shutdownFailures: unknown[] = [];
	constructor(originals: LightscaperNativeOriginalStoreCurrentV1, database: DatabaseSync) {
		this.#originals = originals; this.#database = database;
		void this.retired.catch(() => undefined);
	}
	begin(sourceId: string, metadata: Readonly<Record<string, unknown>>, options: MediaAssetWriteOptions): Promise<MediaAssetWriter> {
		const initializing = this.#initialize(sourceId, metadata, options);
		void initializing.then(() => { this.#captured.resolve(); }, () => { this.#captured.resolve(); });
		return initializing.catch(async (primary: unknown) => { this.#remember(primary); await this.#retireAfter(primary); throw primary; });
	}
	async #initialize(sourceId: string, metadata: Readonly<Record<string, unknown>>, options: MediaAssetWriteOptions): Promise<MediaAssetWriter> {
		const shutdown = Reflect.apply(SIGNAL, this.#stop, []) as AbortSignal;
		const admitted = captureOptions(options, shutdown, ['expectedBytes', 'expectedSha256', 'signal'], ['expectedBytes', 'expectedSha256']);
		this.#scope = admitted;
		this.#cancel = (): void => { void this.retire().catch(() => undefined); };
		Reflect.apply(ADD, admitted.signal, ['abort', this.#cancel, { once: true }]); check(admitted.signal);
		const binding = readLightscaperNativeOriginalBindingCurrentV1({ storageKey: sourceId,
			byteLength: field(admitted.options, 'expectedBytes', 'native streamed media options'),
			contentSha256: field(admitted.options, 'expectedSha256', 'native streamed media options') });
		const descriptive = await captureLightscaperNativePhotoMediaMetadataCurrentV1(binding.storageKey, metadata);
		check(admitted.signal);
		if (getLightscaperNativePhotoMediaAssetCurrentV1(this.#database, binding.storageKey)) throw new Error('Immutable native Photo media asset cannot be overwritten.');
		this.#stream = new LightscaperNativeOriginalStreamCurrentV1(this.#originals, binding, admitted.signal); this.#state = 'open';
		const write = (bytes: Uint8Array, value: Options = {}): Promise<void> => this.#write(bytes, value);
		const commit = (value: Options = {}): Promise<Readonly<Record<string, unknown>>> => this.#commit(value, (proof, signal) =>
			installLightscaperNativePhotoMediaStreamAssetCurrentV1(this.#database, descriptive, binding, proof, signal));
		const bytesWritten = (): number => this.#stream!.bytesWritten;
		return Object.freeze({ maximumChunkBytes: this.#stream.maximumChunkBytes, get bytesWritten() { return bytesWritten(); },
			write, commit, abort: () => this.#abort() });
	}
	#write(bytes: Uint8Array, options: Options): Promise<void> {
		if (this.#state !== 'open') return Promise.reject(new Error('Native streamed media writer is closed.'));
		if (this.#writeWork) return Promise.reject(new Error('A native streamed media write is already pending.'));
		const pending = deferred<void>(); this.#writeWork = pending.promise;
		// Register the actual work before either options or byte reflection.
		void (async () => {
			const operation = this.#operation(options);
			try { await this.#stream!.write(bytes); check(operation.signal); }
			finally { operation.detach(); }
		})().then(pending.resolve, (error: unknown) => { this.#remember(error); pending.reject(error); });
		return pending.promise.then(() => { this.#writeWork = null; }, async (primary: unknown) => {
			await this.#retireAfter(primary); throw primary;
		});
	}
	#commit(options: Options, publish: (proof: unknown, signal: AbortSignal) => Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
		if (this.#commitResult) return this.#commitResult;
		if (this.#state !== 'open') return Promise.reject(new Error('Native streamed media writer is closed.'));
		this.#state = 'committing';
		const pending = deferred<Readonly<Record<string, unknown>>>(); this.#commitWork = pending.promise;
		this.#commitResult = pending.promise.then(async value => { await this.retire(); return value; }, async (primary: unknown) => {
			await this.#retireAfter(primary); throw primary;
		});
		void (async () => {
			const operation = this.#operation(options);
			try {
				await this.#writeWork; check(operation.signal);
				const proof = await this.#stream!.finish(); check(operation.signal);
				return publish(proof, operation.signal);
			} finally { operation.detach(); }
		})().then(pending.resolve, (error: unknown) => { this.#remember(error); pending.reject(error); });
		return this.#commitResult;
	}
	#abort(): Promise<void> {
		if (this.#abortResult) return this.#abortResult;
		// Public abort joins an admitted commit. Owner/caller cancellation uses
		// retire directly and can still cancel its prepublication native work.
		this.#abortResult = this.#commitResult ? this.#commitResult.then(() => undefined, () => undefined) : this.retire();
		return this.#abortResult;
	}
	#operation(options: Options): Link {
		const captured = captureOptions(options, this.#scope!.signal, ['signal'], []);
		const cancel = (): void => { Reflect.apply(ABORT, this.#stop, [Reflect.apply(REASON, captured.signal, [])]); };
		Reflect.apply(ADD, captured.signal, ['abort', cancel, { once: true }]);
		try { check(captured.signal); }
		catch (primary) {
			Reflect.apply(REMOVE, captured.signal, ['abort', cancel]); captured.detach(); throw primary;
		}
		return { signal: captured.signal, detach() { Reflect.apply(REMOVE, captured.signal, ['abort', cancel]); captured.detach(); } };
	}
	retire(): Promise<void> {
		if (this.#retiring) return this.retired;
		this.#retiring = true; this.#state = 'retiring';
		try { Reflect.apply(ABORT, this.#stop, [new Error('Native Photo streamed writer is retiring.')]); }
		catch (error) { this.#shutdownFailures.push(error); }
		void this.#retire().then(this.#retirement.resolve, this.#retirement.reject);
		return this.retired;
	}
	async #retire(): Promise<void> {
		await this.#captured.promise;
		const aborting = this.#stream?.abort();
		const results = await Promise.allSettled([this.#writeWork, this.#commitWork, aborting]);
		const physical = results[2];
		if (physical.status === 'rejected' && (!this.#hasFailure || physical.reason !== this.#failure)) this.#shutdownFailures.push(physical.reason as unknown);
		try {
			if (this.#scope && this.#cancel) Reflect.apply(REMOVE, this.#scope.signal, ['abort', this.#cancel]);
			this.#scope?.detach();
		} catch (error) { this.#shutdownFailures.push(error); }
		if (this.#shutdownFailures.length) throw new AggregateError(this.#shutdownFailures, 'Native Photo writer cleanup failed.');
	}
	#remember(error: unknown): void { if (!this.#hasFailure) { this.#failure = error; this.#hasFailure = true; } }
	async #retireAfter(primary: unknown): Promise<void> {
		try { await this.retire(); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo streaming and retirement failed.', { cause: cleanup }); }
	}
}

function captureOptions(value: unknown, shutdown: AbortSignal, allowed: readonly string[], required: readonly string[]): Link & { options: Record<string, unknown> } {
	const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
	if (caller !== undefined) assertPhotoStackQuerySignalV1(caller);
	const captured = link(caller as AbortSignal | undefined, shutdown);
	try {
		check(captured.signal);
		const options = record(value, 'native streamed media options', allowed, required);
		const signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'native streamed media options') : undefined;
		if (signal !== caller) throw new TypeError('Native streamed media signal changed during admission.');
		check(captured.signal); return { ...captured, options };
	} catch (primary) {
		try { captured.detach(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native writer options and signal retirement failed.', { cause: cleanup }); }
		throw primary;
	}
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void, reject!: (error: unknown) => void;
	const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
	return { promise, resolve, reject };
}
