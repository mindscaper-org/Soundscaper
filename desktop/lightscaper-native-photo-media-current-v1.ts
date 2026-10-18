/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { MediaCatalogOriginalRepositoryV1 } from '../src/common/editor/storage/media-catalog-original-repository.ts';
import type { MediaAssetWriter, MediaAssetWriteOptions } from '../src/common/editor/storage/media-asset-write-contract.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { readLightscaperNativeOriginalCurrentV1, readLightscaperNativeOriginalStorageKeyCurrentV1 as readKey } from './lightscaper-native-original-contract-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';
import { openLightscaperNativePhotoMediaDatabaseCurrentV1 } from './lightscaper-native-photo-media-files-current-v1.ts';
import { captureLightscaperNativePhotoMediaWriteCurrentV1, digestLightscaperNativePhotoMediaWriteCurrentV1,
	lightscaperNativePhotoMediaWriteChunksCurrentV1 } from './lightscaper-native-photo-media-blob-current-v1.ts';
import { deleteLightscaperNativePhotoMediaAssetCurrentV1, getLightscaperNativePhotoMediaAssetCurrentV1,
	installLightscaperNativePhotoMediaAssetCurrentV1 } from './lightscaper-native-photo-media-assets-current-v1.ts';
import { captureLightscaperNativePhotoCustodyRequestCurrentV1, executeLightscaperNativePhotoCustodyRequestCurrentV1 } from './lightscaper-native-photo-media-custody-current-v1.ts';
import { LightscaperNativePhotoMediaLifetimeCurrentV1, checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import type { LightscaperNativePhotoOriginalGroupReservationCurrentV1 as GroupReservation } from './lightscaper-native-photo-original-read-pins-current-v1.ts';
import { LightscaperNativePhotoMediaOriginalReadsCurrentV1 } from './lightscaper-native-photo-media-original-reads-current-v1.ts';
import { captureLightscaperNativePhotoOriginalReadRequestCurrentV1 } from './lightscaper-native-photo-original-read-authority-current-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { LightscaperNativePhotoMediaWritersCurrentV1 } from './lightscaper-native-photo-media-writers-current-v1.ts';

type Options = Readonly<{ signal?: AbortSignal }>;
type Custody = Pick<MediaCatalogOriginalRepositoryV1, 'retain' | 'stage' | 'release' | 'releaseStaged' | 'promote' | 'readPage' | 'findDigestPage'>;

/** Main-private managed Originals and scalar custody. This genuine component
 * composes with Current import/recovery; it does not implement a complete media
 * store, renderer loader, restored namespace allocator or native Session. */
export class LightscaperNativePhotoMediaCurrentV1 {
	readonly catalogOriginals: Custody;
	readonly #originals: LightscaperNativeOriginalStoreCurrentV1;
	readonly #database: DatabaseSync;
	readonly #lifetime = new LightscaperNativePhotoMediaLifetimeCurrentV1();
	readonly #writers: LightscaperNativePhotoMediaWritersCurrentV1;
	readonly #reads: LightscaperNativePhotoMediaOriginalReadsCurrentV1;
	#closing: Promise<void> | null = null;
	#quiescing: Promise<void> | null = null;
	private constructor(originals: LightscaperNativeOriginalStoreCurrentV1, database: DatabaseSync) {
		this.#originals = originals; this.#database = database;
		this.#reads = new LightscaperNativePhotoMediaOriginalReadsCurrentV1(database, originals, (options, capture, operation) => this.#run(options, capture, operation));
		this.#writers = new LightscaperNativePhotoMediaWritersCurrentV1(originals, database);
		this.catalogOriginals = Object.freeze<Custody>({
			retain: (catalog, references, options) => this.#custody('retain', [catalog, references], options),
			stage: (catalog, imported, references, options) => this.#custody('stage', [catalog, imported, references], options),
			release: (catalog, photos, options) => this.#custody('release', [catalog, photos], options),
			releaseStaged: (catalog, imported, photos, options) => this.#custody('releaseStaged', [catalog, imported, photos], options),
			promote: (catalog, imported, photos, options) => this.#custody('promote', [catalog, imported, photos], options),
			readPage: (query, options) => this.#custody('readPage', [query], options),
			findDigestPage: (sha256, after = null, options) => this.#custody('findDigestPage', [sha256, after], options),
		});
	}

	static async open(options: Readonly<{ appDataPath: string }>): Promise<LightscaperNativePhotoMediaCurrentV1> {
		const input = record(options, 'native Photo media owner', ['appDataPath']);
		const root = field(input, 'appDataPath', 'native Photo media owner');
		if (typeof root !== 'string') throw new TypeError('Native Photo media requires its main-owned appData directory.');
		const originals = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath: root });
		let database: DatabaseSync | undefined;
		try {
			database = await openLightscaperNativePhotoMediaDatabaseCurrentV1(root);
			return new LightscaperNativePhotoMediaCurrentV1(originals, database);
		} catch (primary) {
			const failures: unknown[] = [primary];
			try { database?.close(); } catch (error) { failures.push(error); }
			try { await originals.close(); } catch (error) { failures.push(error); }
			if (failures.length > 1) throw new AggregateError(failures, 'Native Photo media opening and retirement failed.', { cause: primary });
			throw primary;
		}
	}

	/** Main-private fixed reader composition; never a renderer filesystem API. */
	readonly reserveOriginalRead = (): Readonly<{ release(): void }> => {
		if (this.#closing || this.#quiescing) throw new Error('Native Photo media is closed.'); return this.#reads.reserve();
	};
	readonly reserveOriginalGroup = (count: number): Readonly<GroupReservation> => {
		if (this.#closing || this.#quiescing) throw new Error('Native Photo media is closed.'); return this.#reads.reserveGroup(count);
	};
	readonly acquireOriginalGroupRead = (value: unknown, group: Readonly<GroupReservation>, index: number, options: Options = {}) => this.#run(options, () => {
		const input = record(options, 'native Original group lease options', ['signal'], []);
		const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'native Original group lease options') : undefined;
		if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
		return { request: captureLightscaperNativePhotoOriginalReadRequestCurrentV1(value), signal, group, index };
	}, (input, signal) => { check(signal); return this.#reads.acquireGroup(input.request, input.group, input.index, input.signal); });

	readonly acquireOriginalRead = (value: unknown, options: Options = {}) => this.#run(options, () => {
		const input = record(options, 'native Original lease options', ['signal'], []);
		const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'native Original lease options') : undefined;
		if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
		return { request: captureLightscaperNativePhotoOriginalReadRequestCurrentV1(value), signal };
	}, (input, signal) => { check(signal); return this.#reads.acquire(input.request, input.signal); });

	readonly beginAssetWrite = (sourceId: string, metadata: Readonly<Record<string, unknown>>, options: MediaAssetWriteOptions): Promise<MediaAssetWriter> => {
		if (this.#closing || this.#quiescing) return Promise.reject(new Error('Native Photo media is closed.'));
		return this.#writers.begin(sourceId, metadata, options);
	};

	readonly writeAsset = (sourceId: string, blob: Blob, metadata: unknown = {}, options: Options = {}): Promise<Record<string, unknown>> =>
		this.#run(options, async () => {
			const assetId = readKey(sourceId), captured = await captureLightscaperNativePhotoMediaWriteCurrentV1(assetId, blob, metadata);
			return { assetId, captured };
		}, async ({ assetId, captured }, signal) => {
			if (getLightscaperNativePhotoMediaAssetCurrentV1(this.#database, assetId)) throw new Error('Immutable native Photo media asset cannot be overwritten.');
			const binding = await digestLightscaperNativePhotoMediaWriteCurrentV1(captured, signal);
			const proof = await this.#originals.storeBinding(binding, lightscaperNativePhotoMediaWriteChunksCurrentV1(captured, signal), { signal });
			return installLightscaperNativePhotoMediaAssetCurrentV1(this.#database, captured, proof, signal);
		});

	readonly getAssetMetadata = (sourceId: string): Promise<Record<string, unknown> | null> =>
		this.#run({}, () => readKey(sourceId), (key, signal) => {
			const result = getLightscaperNativePhotoMediaAssetCurrentV1(this.#database, key); check(signal); return result;
		});

	readonly deleteAsset = (sourceId: string, options: Options = {}): Promise<void> =>
		this.#run(options, () => readKey(sourceId), (key, signal) => {
			deleteLightscaperNativePhotoMediaAssetCurrentV1(this.#database, key, signal);
		});

	readonly verifyOriginal = (value: unknown, options: Options = {}): Promise<void> =>
		this.#run(options, () => readLightscaperNativeOriginalCurrentV1(value), async (original, signal) => {
			this.#require(original); await this.#originals.verify(original, { signal }); check(signal);
		});

	readonly readOriginal = (value: unknown, offset: number, length: number, options: Options = {}): Promise<Uint8Array> =>
		this.#run(options, () => readLightscaperNativeOriginalCurrentV1(value), async (original, signal) => {
			this.#require(original); const bytes = await this.#originals.read(original, offset, length, { signal }); check(signal); return bytes;
		});

	/** Fence all front doors and retire escaped producers before a parent
	 * waits for Original reads queued behind their genuine physical stream. */
	readonly quiesceEscapedWritersCurrentV1 = (): Promise<void> => this.#quiesce();

	#quiesce(): Promise<void> {
		if (this.#quiescing) return this.#quiescing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#quiescing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		try { void this.#writers.close().then(resolve, reject); } catch (error) { reject(error); }
		return this.#quiescing;
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		// Idle escaped writers must be canceled before the ordinary queue can
		// join a request waiting behind their real Original producer.
		const writers = this.#quiesce(), readers = this.#reads.close();
		void writers.catch(() => undefined); void readers.catch(() => undefined);
		void this.#lifetime.close(async () => {
			const failures: unknown[] = [];
			try { await writers; } catch (error) { failures.push(error); }
			try { await readers; } catch (error) {
				failures.push(error); throw new AggregateError(failures, 'Native Original consumers did not retire; media owners retained.', { cause: error });
			}
			const results = await Promise.allSettled([this.#originals.close(), Promise.resolve().then(() => { this.#database.close(); })]);
			failures.push(...results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []));
			if (failures.length) throw new AggregateError(failures, 'Native Photo media owners did not retire.');
		}).then(resolve, reject);
		return this.#closing;
	}

	#require(original: Readonly<PhotoOriginalV1>): void {
		const metadata = getLightscaperNativePhotoMediaAssetCurrentV1(this.#database, original.storageKey);
		if (!metadata || metadata.sourceId !== original.storageKey || metadata.sha256 !== original.contentSha256 || metadata.size !== original.byteLength) {
			throw new Error('Native Photo Original has no matching committed managed asset.');
		}
	}
	#custody<Method extends keyof Custody>(method: Method, args: readonly unknown[], options: Options | undefined): ReturnType<Custody[Method]> {
		return this.#run(options,
			signal => captureLightscaperNativePhotoCustodyRequestCurrentV1(method, [...args, Object.freeze({ signal })]),
			(packet, signal) => executeLightscaperNativePhotoCustodyRequestCurrentV1(this.#database, packet, signal)) as ReturnType<Custody[Method]>;
	}
	#run<Input, Result>(options: unknown, capture: (signal: AbortSignal) => Input | Promise<Input>, operation: (input: Input, signal: AbortSignal) => Result | Promise<Result>): Promise<Result> {
		if (this.#closing || this.#quiescing) return Promise.reject(new Error('Native Photo media is closed.'));
		return this.#lifetime.run(options, capture, operation);
	}
}
