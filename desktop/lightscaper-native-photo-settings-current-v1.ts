/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { PhotoMediaSettingsRepositoryV1 as Settings } from '../src/lightscaper/storage/photo-media-store.ts';
import { openLightscaperNativePhotoSettingsDatabaseCurrentV1 } from './lightscaper-native-photo-settings-files-current-v1.ts';
import { LightscaperNativePhotoSettingsLifetimeCurrentV1 } from './lightscaper-native-photo-settings-lifetime-current-v1.ts';
import { captureLightscaperNativePhotoSettingsRequestCurrentV1 } from './lightscaper-native-photo-settings-request-current-v1.ts';
import { executeLightscaperNativePhotoSettingsRequestCurrentV1 } from './lightscaper-native-photo-settings-records-current-v1.ts';

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

	close(): Promise<void> { return this.#lifetime.close(() => { this.#database.close(); }); }

	#request<Method extends keyof Settings>(method: Method, args: Parameters<Settings[Method]>): ReturnType<Settings[Method]> {
		return this.#lifetime.run(() => captureLightscaperNativePhotoSettingsRequestCurrentV1(method, args, this.#scope),
			request => executeLightscaperNativePhotoSettingsRequestCurrentV1(this.#database, this.#scope, request)) as ReturnType<Settings[Method]>;
	}
}
