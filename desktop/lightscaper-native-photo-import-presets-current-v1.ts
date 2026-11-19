/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import type { KeyValueEntry } from '../src/common/editor/storage/key-value-repository.ts';
import type { PhotoMediaSettingsRepositoryV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import type { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';

export type LightscaperNativePhotoImportPresetRepositoryCurrentV1 = Readonly<Pick<PhotoMediaSettingsRepositoryV1,
	'get' | 'readEntry' | 'putIfAbsent' | 'replaceIfCurrent'>>;
type Repository = LightscaperNativePhotoImportPresetRepositoryCurrentV1;
type Binding = Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
const CHECK = AbortSignal.prototype.throwIfAborted;

/** The selected lease supplies its genuine epoch binding and the actual
 * manager anchor. This fixed key facet grants no selection/history access and
 * does not close the app-lifetime anchor. Labels do not supply authority. */
export class LightscaperNativePhotoImportPresetsCurrentV1 {
	readonly settingsRepository: Repository;
	readonly #catalogId: string;
	readonly #key: string;
	readonly #signal: AbortSignal;
	readonly #assert: () => void;
	readonly #dispatch: Settings['executeImportPresetRequestCurrentV1'];
	readonly #readBounded: () => Promise<KeyValueEntry>;
	readonly #active = new Set<Promise<unknown>>();
	#closed = false;
	#closing: Promise<void> | null = null;

	private constructor(anchor: Settings, catalogId: string, binding: Binding) {
		this.#catalogId = id(catalogId, 'native import-preset catalog ID');
		this.#key = photoImportPresetsKeyV1(this.#catalogId);
		const input = record(binding, 'native import-preset epoch', ['signal', 'assertCurrent']);
		const signal = field(input, 'signal', 'native import-preset epoch'); assertPhotoStackQuerySignalV1(signal);
		const assertion = field(input, 'assertCurrent', 'native import-preset epoch');
		if (typeof assertion !== 'function') throw new TypeError('Native import presets require their selected epoch assertion.');
		this.#signal = signal; this.#assert = () => { Reflect.apply(assertion, binding, []); };
		const dispatch = anchor.executeImportPresetRequestCurrentV1;
		if (typeof dispatch !== 'function') throw new TypeError('Native import presets require the actual fixed-anchor request owner.');
		this.#dispatch = dispatch.bind(anchor);
		const bounded = anchor.readSessionDomainEntryCurrentV1;
		if (typeof bounded !== 'function') throw new TypeError('Native import presets require their bounded physical domain owner.');
		this.#readBounded = () => Reflect.apply(bounded, anchor, [this.#catalogId, 'import-presets']) as Promise<KeyValueEntry>;
		this.#check();
		this.settingsRepository = Object.freeze<Repository>({
			get: (...args) => this.#request('get', args),
			readEntry: (...args) => this.#request('readEntry', args),
			putIfAbsent: (...args) => this.#request('putIfAbsent', args),
			replaceIfCurrent: (...args) => this.#request('replaceIfCurrent', args),
		});
	}

	static create(anchor: Settings, catalogId: string, binding: Binding): LightscaperNativePhotoImportPresetsCurrentV1 {
		return new LightscaperNativePhotoImportPresetsCurrentV1(anchor, catalogId, binding);
	}

	readEntryCurrentV1(): Promise<KeyValueEntry> {
		if (this.#closed) return Promise.reject(new Error('Native import-preset facet is closed.'));
		let resolve!: (value: KeyValueEntry) => void, reject!: (failure: unknown) => void;
		const pending = new Promise<KeyValueEntry>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active.add(pending);
		let work: Promise<KeyValueEntry>;
		try { this.#check(); work = this.#readBounded(); } catch (failure) { work = Promise.reject(failure); }
		void work.then(value => { try { this.#check(); this.#active.delete(pending); resolve(value); } catch (failure) { this.#active.delete(pending); reject(failure); } },
			(failure: unknown) => { this.#active.delete(pending); reject(failure); });
		return pending;
	}

	#request<Method extends keyof Repository>(method: Method, args: Parameters<Repository[Method]>): ReturnType<Repository[Method]> {
		if (this.#closed) return Promise.reject(new Error('Native import-preset facet is closed.')) as ReturnType<Repository[Method]>;
		let resolve!: (value: unknown) => void, reject!: (failure: unknown) => void;
		const pending = new Promise<unknown>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#active.add(pending);
		let work: Promise<unknown>;
		try {
			this.#check();
			if (args[0] !== this.#key) throw new TypeError('Native import presets accept only their selected catalog preset key.');
			// Enter the actual Settings capture now. A second facade queue would
			// defer native cloning/canonical capture and admit borrowed mutation.
			work = this.#dispatch(this.#catalogId, method, args, () => { this.#check(); });
		} catch (primary) { work = Promise.reject(primary); }
		void work.then(value => {
			try {
				// A completed true native CAS owns its durable ACK. Reads and a
				// false CAS cannot escape after the selected epoch has retired.
				if (!((method === 'putIfAbsent' || method === 'replaceIfCurrent') && value === true)) this.#check();
				this.#active.delete(pending); resolve(value);
			} catch (primary) { this.#active.delete(pending); reject(primary); }
		}, (primary: unknown) => { this.#active.delete(pending); reject(primary); });
		return pending as ReturnType<Repository[Method]>;
	}

	#check(): void {
		Reflect.apply(CHECK, this.#signal, []);
		if (this.#closed) throw new Error('Native import-preset facet is closed.');
		this.#assert();
		Reflect.apply(CHECK, this.#signal, []);
		if (this.#closed) throw new Error('Native import-preset facet is closed.');
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		let resolve!: () => void;
		this.#closing = new Promise<void>(accept => { resolve = accept; });
		// Every rejected operation remains its caller's exact outcome; all
		// actual Settings clone/codec/SQL work is nevertheless joined first.
		void Promise.allSettled([...this.#active]).then(() => { resolve(); });
		return this.#closing;
	}
}
