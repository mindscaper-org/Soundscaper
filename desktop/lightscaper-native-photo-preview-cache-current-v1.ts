/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../src/common/editor/storage/media-content-digest.ts';
import { normalizeBinaryDerivativeCacheIdentityV1, normalizeBinaryDerivativeCacheProfileV1,
	type BinaryDerivativeCacheProfileV1 as Profile } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import type { BinaryDerivativeCachePortV1 as Port } from '../src/common/editor/storage/binary-derivative-cache-repository.ts';
import { isMediaContentSha256 } from '../src/common/editor/storage/media-content-provenance.ts';
import { openLightscaperNativePhotoMediaDatabaseCurrentV1 } from './lightscaper-native-photo-media-files-current-v1.ts';
import { openLightscaperNativePhotoPreviewDatabaseCurrentV1, lightscaperNativePhotoPreviewDatabasePathCurrentV1 } from './lightscaper-native-photo-preview-cache-database-current-v1.ts';
import { registerLightscaperNativePreviewNamespaceCurrentV1 } from './lightscaper-native-photo-preview-cache-namespace-current-v1.ts';
import { LightscaperNativePhotoMediaLifetimeCurrentV1, checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { lightscaperNativePhotoPreviewCleanupFailureCurrentV1 as cleanupFailure } from './lightscaper-native-photo-preview-cache-records-current-v1.ts';
import { loadLightscaperNativePhotoPreviewCurrentV1 as load, storeLightscaperNativePhotoPreviewCurrentV1 as store,
	trimLightscaperNativePhotoPreviewCurrentV1 as trim } from './lightscaper-native-photo-preview-cache-operations-current-v1.ts';
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;
const OPENING_QUARANTINE = new Set<object>();
type Namespace = ReturnType<typeof registerLightscaperNativePreviewNamespaceCurrentV1>;

/** Actual native disposable bodies. All canonical/culling/HDR adapters use one
 * bounded physical namespace. No metadata BLOB, IDB backend, Original pathname,
 * fabricated content token or persistent reader root enters this owner. */
export class LightscaperNativePhotoPreviewCacheCurrentV1 {
	readonly #cache: DatabaseSync; readonly #source: DatabaseSync; readonly #namespace: Namespace;
	readonly #lifetime = new LightscaperNativePhotoMediaLifetimeCurrentV1(); readonly #cleanup = new Set<unknown>();
	#closing: Promise<void> | null = null;
	private constructor(cache: DatabaseSync, source: DatabaseSync, namespace: Namespace) { this.#cache = cache; this.#source = source; this.#namespace = namespace; }
	static async open(options: Readonly<{ appDataPath: string }>): Promise<LightscaperNativePhotoPreviewCacheCurrentV1> {
		const input = record(options, 'native preview cache options', ['appDataPath']), appDataPath = field(input, 'appDataPath', 'native preview cache options');
		if (typeof appDataPath !== 'string') throw new TypeError('Native preview cache requires its main-owned appData root.');
		let cache: DatabaseSync | undefined, source: DatabaseSync | undefined;
		try {
			source = await openLightscaperNativePhotoMediaDatabaseCurrentV1(appDataPath); cache = await openLightscaperNativePhotoPreviewDatabaseCurrentV1(appDataPath);
			return new LightscaperNativePhotoPreviewCacheCurrentV1(cache, source, registerLightscaperNativePreviewNamespaceCurrentV1(lightscaperNativePhotoPreviewDatabasePathCurrentV1(appDataPath)));
		} catch (primary) {
			const errors: unknown[] = []; for (const db of [cache, source]) { try { db?.close(); } catch (error) { errors.push(error); } }
			if (errors.length) { OPENING_QUARANTINE.add(Object.freeze({ cache, source })); throw new AggregateError([primary, ...errors], 'Native preview opening and retirement failed.', { cause: primary }); } throw primary;
		}
	}
	readonly createBinaryDerivativeCache = (value: unknown): Readonly<Port> => {
		this.#assertAccepting(); const profile = normalizeBinaryDerivativeCacheProfileV1(value); this.#assertAccepting();
		return Object.freeze<Port>({
			load: (value, signal) => this.#run(signal, () => normalizeBinaryDerivativeCacheIdentityV1(value, profile), (identity, linked) => load(this.#databases(), identity, profile, linked)),
			store: (value, body, output, signal) => this.#run(signal, () => this.#capture(value, body, output, profile), async (captured, linked) => {
				const result = await store(this.#databases(), captured, profile, linked);
				for (const error of result.cleanupErrors ?? []) if (cleanupFailure(error)) { this.#cleanup.add(error); this.#namespace.quarantine(this); } return result;
			}),
			trim: signal => this.#run(signal, () => undefined, (_input, linked) => trim(this.#cache, profile, linked)),
		});
	};
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		void this.#lifetime.close(() => {
			for (const db of [this.#cache, this.#source]) { try { if (db.isTransaction) { this.#cleanup.add(new Error('Native preview has an unsettled transaction.')); this.#namespace.quarantine(this); } db.close(); } catch (error) { this.#cleanup.add(error); this.#namespace.quarantine(this); } }
			if (this.#cleanup.size) { this.#namespace.quarantine(this); throw new AggregateError([...this.#cleanup], 'Native preview retirement is unproved; owner retained.'); } this.#namespace.retire();
		}).then(resolve, reject); return this.#closing;
	}
	#capture(value: unknown, input: unknown, output: unknown, profile: Profile) {
		const identity = normalizeBinaryDerivativeCacheIdentityV1(value, profile), body = canonicalMediaContentBlob(input);
		const size = Reflect.apply(SIZE, body, []) as number, mime = Reflect.apply(TYPE, body, []) as string;
		if (size !== identity.byteLength) throw new RangeError('Native preview body size disagrees with its manifest.');
		if (!isMediaContentSha256(output) || mime.length > 256) throw new TypeError('Native preview output SHA or MIME is malformed.');
		return Object.freeze({ identity, body, output, mime });
	}
	#databases() { return Object.freeze({ cache: this.#cache, source: this.#source }); }
	#assertAccepting(): void { if (this.#closing || this.#cleanup.size) throw new Error('Native preview cache is closing, closed or quarantined.'); this.#namespace.assertCurrent(); }
	#run<Input, Result>(signal: AbortSignal | undefined, capture: () => Input, operation: (input: Input, linked: AbortSignal) => Result | Promise<Result>): Promise<Result> {
		let turn: ReturnType<Namespace['reserve']>;
		try { this.#assertAccepting(); turn = this.#namespace.reserve(); } catch (error) { return Promise.reject(error); }
		const work = this.#lifetime.run({ signal }, linked => { try { return capture(); } catch (error) { check(linked); throw error; } }, async (input, linked) => {
			await turn.wait; this.#namespace.assertCurrent(); check(linked); if (this.#cleanup.size) throw new Error('Native preview cache is quarantined.'); return operation(input, linked);
		});
		return work.then(result => { turn.release(); return result; }, (error: unknown) => { if (cleanupFailure(error)) { this.#cleanup.add(error); this.#namespace.quarantine(this); } turn.release(); throw error; });
	}
}
