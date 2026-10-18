/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';
import { normalizePhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { acquireLightscaperNativePhotoLibraryWriterCurrentV1 as acquire, type LightscaperNativePhotoLibraryWriterCurrentV1 as Writer } from './lightscaper-native-photo-library-writer-current-v1.ts';
import { LightscaperNativePhotoLibraryScopeRegistryCurrentV1 as Registry, type LightscaperNativePhotoLibraryAllocationPageCurrentV1 as Page } from './lightscaper-native-photo-library-scope-registry-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import { LightscaperNativePhotoMediaLifetimeCurrentV1 as Lifetime, checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { openLightscaperNativePhotoLibraryComponentsCurrentV1 as openComponents, openLightscaperNativePhotoLibraryOwnerCurrentV1 as openOwner,
	type LightscaperNativePhotoLibraryComponentsCurrentV1 as Components } from './lightscaper-native-photo-library-components-current-v1.ts';

export type LightscaperNativePhotoLibraryScopeCurrentV1 = Readonly<object>;
type Scope = LightscaperNativePhotoLibraryScopeCurrentV1;
type Options = Readonly<{ signal?: AbortSignal }>;
type Binding = Readonly<{ allocation: Readonly<Allocation> | null; appDataPath: string }>;
// Unknown retirement must never let GC release exclusion while a child may
// still own a native handle. Recovery of this exceptional state needs a restart.
const QUARANTINED = new Set<Writer>();

/** Main-private physical allocation and composition. Registry states describe
 * creation only; no selected pointer, restore-ready proof, deletion authority,
 * renderer port or complete native Session is exposed by this component. */
export class LightscaperNativePhotoLibraryScopesCurrentV1 {
	readonly #appDataPath: string;
	readonly #guard: Writer;
	readonly #registry: Registry;
	readonly #anchor: Settings;
	readonly #lifetime = new Lifetime();
	readonly #scopes = new WeakMap<object, Binding>();
	readonly #children = new Set<Readonly<Components>>();
	#unretired = false;
	#closing: Promise<void> | null = null;
	private constructor(appDataPath: string, guard: Writer, registry: Registry, anchor: Settings) {
		this.#appDataPath = appDataPath; this.#guard = guard; this.#registry = registry; this.#anchor = anchor;
	}
	static async open(options: Readonly<{ appDataPath: string }>): Promise<LightscaperNativePhotoLibraryScopesCurrentV1> {
		const input = record(options, 'native library scopes', ['appDataPath']), appDataPath = field(input, 'appDataPath', 'native library scopes');
		if (typeof appDataPath !== 'string') throw new TypeError('Native library scopes require their main-owned appData root.');
		const guard = await acquire(appDataPath);
		let registry: Registry | undefined, anchor: Settings | undefined, unretired = false;
		const quarantine = (): void => { unretired = true; QUARANTINED.add(guard); };
		try {
			guard.assertCurrent(); registry = await openOwner(() => Registry.open(appDataPath), quarantine);
			guard.assertCurrent(); anchor = await openOwner(() => Settings.open({ appDataPath, scope: 'anchor' }), quarantine); guard.assertCurrent();
			return new LightscaperNativePhotoLibraryScopesCurrentV1(appDataPath, guard, registry, anchor);
		} catch (primary) {
			const cleanup: unknown[] = [];
			try { await registry?.close(); } catch (error) { cleanup.push(error); }
			try { await anchor?.close(); } catch (error) { cleanup.push(error); }
			if (!cleanup.length && !unretired) { try { await guard.close(); } catch (error) { cleanup.push(error); } }
			if (cleanup.length) { QUARANTINED.add(guard); throw new AggregateError([primary, ...cleanup], 'Native library opening and retirement failed.', { cause: primary }); }
			throw primary;
		}
	}

	openDefault(options: Options = {}): Promise<Scope> {
		return this.#run(options, () => undefined, (_input, signal) => {
			this.#guard.assertCurrent(); check(signal); return this.#mint({ allocation: null, appDataPath: this.#appDataPath });
		});
	}
	allocate(catalogId: string, options: Options = {}): Promise<Scope> {
		return this.#run(options, () => id(catalogId, 'native restore catalog ID'), async (catalog, signal) => {
			this.#guard.assertCurrent(); const namespaceToken = randomBytes(16).toString('hex');
			let ownerToken: string; do { ownerToken = randomBytes(16).toString('hex'); } while (ownerToken === namespaceToken);
			const allocation = normalizePhotoLibraryRestoreAllocationV1({ schemaVersion: 1, kind: 'photo-library-restore-allocation',
				operationId: namespaceToken, namespaceToken, ownerToken, catalogId: catalog });
			// The genuine created COMMIT owns its ACK, including late cancellation.
			return this.#mint(await this.#registry.allocate(allocation, signal));
		});
	}
	resume(namespaceToken: string, options: Options = {}): Promise<Scope> {
		return this.#run(options, () => token(namespaceToken), async (namespace, signal) => {
			this.#guard.assertCurrent(); return this.#mint(await this.#registry.resume(namespace, signal));
		});
	}
	describe(scope: Scope): Readonly<Allocation> | null { this.#assertAccepting(); return this.#binding(scope).allocation; }
	openComponents(scope: Scope, options: Options = {}): Promise<Readonly<Components>> {
		return this.#run(options, () => this.#binding(scope), async (binding, signal) => {
			this.#guard.assertCurrent(); check(signal);
			if (binding.allocation) {
				const current = await this.#registry.resume(binding.allocation.namespaceToken, signal);
				if (JSON.stringify(current.allocation) !== JSON.stringify(binding.allocation) || current.appDataPath !== binding.appDataPath) {
					throw new Error('Native library scope no longer matches its actual durable reservation.');
				}
			}
			this.#guard.assertCurrent(); check(signal);
			const components = await openComponents(binding.appDataPath, signal, () => { this.#quarantine(); });
			this.#children.add(components);
			try { this.#guard.assertCurrent(); check(signal); return components; }
			catch (primary) {
				try { await components.close(); }
				catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library component admission and retirement failed.', { cause: cleanup }); }
				throw primary;
			}
		});
	}
	readAllocationPage(afterToken: string | null = null, options: Options = {}): Promise<Readonly<Page>> {
		return this.#run(options, () => afterToken === null ? null : token(afterToken), (after, signal) => {
			this.#guard.assertCurrent(); return this.#registry.readPage(after, signal);
		});
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		void this.#lifetime.close(async () => {
			const results = await Promise.allSettled([...this.#children].map(child => child.close()));
			const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			try { await this.#registry.close(); } catch (error) { failures.push(error); }
			try { await this.#anchor.close(); } catch (error) { failures.push(error); }
			if (failures.length || this.#unretired) {
				this.#quarantine(); throw new AggregateError(failures, 'Native library retirement is unproved; writer guard retained.');
			}
			try { await this.#guard.close(); } catch (error) { this.#quarantine(); throw error; }
		}).then(resolve, reject);
		return this.#closing;
	}
	#run<Input, Result>(options: Options, capture: (signal: AbortSignal) => Input | Promise<Input>,
		operation: (input: Input, signal: AbortSignal) => Result | Promise<Result>): Promise<Result> {
		try { this.#assertAccepting(); } catch (error) { return Promise.reject(error); }
		return this.#lifetime.run(options, capture, (input, signal) => { this.#assertAccepting(); return operation(input, signal); });
	}
	#mint(binding: Binding): Scope { const scope = Object.freeze({}); this.#scopes.set(scope, Object.freeze(binding)); return scope; }
	#binding(value: unknown): Binding {
		this.#assertAccepting();
		const binding = value !== null && typeof value === 'object' ? this.#scopes.get(value) : undefined;
		if (!binding) throw new TypeError('Native library scopes require a genuine capability from this owner.');
		return binding;
	}
	#assertAccepting(): void {
		if (this.#closing || this.#unretired) throw new Error('Native library scopes are closing, closed or quarantined.');
		this.#guard.assertCurrent();
	}
	#quarantine(): void { this.#unretired = true; QUARANTINED.add(this.#guard); }
}
function token(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) throw new TypeError('Native library namespace requires 32 lowercase hexadecimal characters.');
	return value;
}
