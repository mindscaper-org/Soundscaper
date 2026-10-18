/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { KeyValueEntry, KeyValueWriteAdmission } from '../src/common/editor/storage/key-value-repository.ts';
import { readLightscaperNativePhotoLibraryAnchorKeyCurrentV1 as anchorKey, readLightscaperNativePhotoLibraryAnchorEntryCurrentV1 as anchorRead, captureLightscaperNativePhotoLibraryAnchorPairCurrentV1 as anchorCapture, publishLightscaperNativePhotoLibraryAnchorPairCurrentV1 as anchorPublish } from './lightscaper-native-photo-library-anchor-current-v1.ts';
import type { PhotoMediaSettingsRepositoryV1 as Settings } from '../src/lightscaper/storage/photo-media-store.ts';
import { openLightscaperNativePhotoSettingsDatabaseCurrentV1 } from './lightscaper-native-photo-settings-files-current-v1.ts';
import { LightscaperNativePhotoSettingsLifetimeCurrentV1 } from './lightscaper-native-photo-settings-lifetime-current-v1.ts';
import { captureLightscaperNativePhotoSettingsRequestCurrentV1, encodeLightscaperNativePhotoSettingKeyCurrentV1 } from './lightscaper-native-photo-settings-request-current-v1.ts';
import { decodeLightscaperNativePhotoSettingCurrentV1 } from './lightscaper-native-photo-settings-codec-current-v1.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1, type PhotoImportIntentV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';
import { photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { executeLightscaperNativePhotoSettingsRequestCurrentV1 } from './lightscaper-native-photo-settings-records-current-v1.ts';

type ImportPresetMethod = 'get' | 'readEntry' | 'putIfAbsent' | 'replaceIfCurrent';

/** Main-private settings custody. A scope is an immutable binding supplied by
 * the host, not proof of an allocation, selected library or deletion authority.
 * This component alone neither selects nor activates a native Session. */
export class LightscaperNativePhotoSettingsCurrentV1 {
	readonly settingsRepository: Settings;
	readonly #database: DatabaseSync;
	readonly #scope: string;
	readonly #lifetime = new LightscaperNativePhotoSettingsLifetimeCurrentV1();
	private constructor(database: DatabaseSync, scope: string) {
		this.#database = database; this.#scope = scope;
		this.settingsRepository = Object.freeze<Settings>({
			get: (...args) => this.#request('get', args),
			readEntry: (...args) => this.#request('readEntry', args),
			put: (...args) => this.#request('put', args),
			delete: (...args) => this.#request('delete', args),
			putIfAbsent: (...args) => this.#request('putIfAbsent', args),
			replaceIfCurrent: (...args) => this.#request('replaceIfCurrent', args),
			deleteIfCurrent: (...args) => this.#request('deleteIfCurrent', args),
			replaceIfCurrentAndPutIfAbsent: (...args) => this.#request('replaceIfCurrentAndPutIfAbsent', args),
		});
	}

	static async open(options: Readonly<{ appDataPath: string; scope?: string }>): Promise<LightscaperNativePhotoSettingsCurrentV1> {
		const input = record(options, 'native Photo settings owner', ['appDataPath', 'scope'], ['appDataPath']);
		const path = field(input, 'appDataPath', 'native Photo settings owner');
		const selected = Object.hasOwn(input, 'scope') ? field(input, 'scope', 'native Photo settings owner') : undefined;
		const scope = selected === undefined ? 'anchor' : selected;
		if (typeof path !== 'string') throw new TypeError('Native Photo settings require their main-owned appData directory.');
		if (typeof scope !== 'string' || (scope !== 'anchor' && !/^selected:[a-z0-9][a-z0-9._-]{0,127}$/u.test(scope))) {
			throw new TypeError('Native Photo settings require a fixed anchor or bounded selected scope.');
		}
		const database = await openLightscaperNativePhotoSettingsDatabaseCurrentV1(path);
		try { return new LightscaperNativePhotoSettingsCurrentV1(database, scope); }
		catch (primary) {
			try { database.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo settings opening and retirement failed.', { cause: cleanup }); }
			throw primary;
		}
	}

	/** Fixed main-private custody read. Generic settings deliberately support
	 * large structured-clone values; an import intent cannot decode those before
	 * its owning scalar admission. Presence is distinct from invalid occupancy. */
	readImportIntentCurrentV1(catalogId: string): Promise<Readonly<PhotoImportIntentV1> | null> {
		return this.#lifetime.run(() => {
			const catalog = id(catalogId, 'native import intent catalog ID');
			return { catalog, key: encodeLightscaperNativePhotoSettingKeyCurrentV1(photoImportIntentKeyV1(catalog)) };
		}, ({ catalog, key }) => {
			if (this.#database.isTransaction) throw new Error('Native Photo intent requires ownership of its read.');
			// Every legal four-field ASCII-ID intent fits this codec envelope. The
			// generic settings repository's value domain and payload sizes stay intact.
			const row = this.#database.prepare(`SELECT length(payload) AS payload_bytes,
				CASE WHEN typeof(payload)='blob' AND length(payload)<=4096 THEN payload END AS payload
				FROM native_photo_settings WHERE scope=? AND key=?`).get(this.#scope, key);
			if (!row) return null;
			if (typeof row.payload_bytes !== 'number' || !Number.isSafeInteger(row.payload_bytes) || row.payload_bytes < 0) {
				throw new TypeError('Native Photo import intent payload is not an owned BLOB.');
			}
			if (row.payload_bytes > 4096) throw new RangeError('Native Photo import intent exceeds its encoded byte bound.');
			if (!(row.payload instanceof Uint8Array) || row.payload.byteLength !== row.payload_bytes) throw new TypeError('Native Photo import intent payload is malformed.');
			return normalizePhotoImportIntentV1(decodeLightscaperNativePhotoSettingCurrentV1(row.payload), catalog);
		});
	}

	/** Fixed-anchor single-key request for the genuine selected Session lease.
	 * Native clone/canonical capture occurs before queue wait; epoch admission
	 * is repeated inside the actual transaction before a durable CAS ACK. */
	executeImportPresetRequestCurrentV1<Method extends ImportPresetMethod>(catalogId: string, method: Method,
		args: Parameters<Settings[Method]>, assertCurrent: () => void): ReturnType<Settings[Method]> {
		return this.#lifetime.run(() => {
			this.#assertAnchor();
			if (typeof assertCurrent !== 'function') throw new TypeError('Native import presets require selected epoch admission.');
			assertCurrent(); const catalog = id(catalogId, 'native import-preset catalog ID');
			if (method !== 'get' && method !== 'readEntry' && method !== 'putIfAbsent' && method !== 'replaceIfCurrent') throw new TypeError('Native import presets require a fixed settings method.');
			if (args[0] !== photoImportPresetsKeyV1(catalog)) throw new TypeError('Native import presets require their exact selected catalog key.');
			return captureLightscaperNativePhotoSettingsRequestCurrentV1(method, args, this.#scope);
		}, request => {
			assertCurrent();
			return executeLightscaperNativePhotoSettingsRequestCurrentV1(this.#database, this.#scope, request, assertCurrent);
		}) as ReturnType<Settings[Method]>;
	}

	readLibraryAnchorEntryCurrentV1(key: string): Promise<KeyValueEntry> {
		return this.#lifetime.run(() => { this.#assertAnchor(); return anchorKey(key); }, captured => {
			if (this.#database.isTransaction) throw new Error('Native library authority requires its own read.');
			return anchorRead(this.#database, captured);
		});
	}
	publishLibrarySelectionCurrentV1(expected: unknown, pointer: unknown, historyKey: string, history: unknown, admission?: KeyValueWriteAdmission): Promise<boolean> {
		return this.#lifetime.run(() => { this.#assertAnchor(); return anchorCapture(expected, pointer, historyKey, history, admission); },
			request => anchorPublish(this.#database, request));
	}
	#assertAnchor(): void { if (this.#scope !== 'anchor') throw new Error('Native library authority requires the fixed settings anchor.'); }

	close(): Promise<void> { return this.#lifetime.close(() => { this.#database.close(); }); }

	#request<Method extends keyof Settings>(method: Method, args: Parameters<Settings[Method]>): ReturnType<Settings[Method]> {
		return this.#lifetime.run(() => captureLightscaperNativePhotoSettingsRequestCurrentV1(method, args, this.#scope),
			request => executeLightscaperNativePhotoSettingsRequestCurrentV1(this.#database, this.#scope, request)) as ReturnType<Settings[Method]>;
	}
}
