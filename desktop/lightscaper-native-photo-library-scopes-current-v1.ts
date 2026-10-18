/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { createLightscaperNativePhotoSessionClaimCurrentV1 as sessionClaim } from './lightscaper-native-photo-session-claim-current-v1.ts';
import { createLightscaperNativePhotoSessionLeaseCurrentV1 as sessionLease, type LightscaperNativePhotoSessionLeaseCurrentV1 as SessionLease } from './lightscaper-native-photo-session-lease-current-v1.ts';
import { captureLightscaperNativePhotoLibraryArchiveReadersCurrentV1 as captureReaders } from './lightscaper-native-photo-library-archive-readers-current-v1.ts';
import { registerLightscaperNativePhotoLibraryArchiveOwnerCurrentV1 as registerArchive } from './lightscaper-native-photo-library-archive-owner-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { ScapeProjectInput, ScapeProjectInputReaderFactories } from '../src/common/editor/scape-project-input.ts';
import type { PhotoLibraryRestoreReceiptV1 } from '../src/common/editor/photo-library-restore-port-v1.ts';
import { LightscaperNativePhotoLibrarySelectionCurrentV1 as SelectionOwner, type LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1 as SelectionSnapshot, type LightscaperNativePhotoLibraryPublicationCurrentV1 as Publication } from './lightscaper-native-photo-library-selection-current-v1.ts';
import { consumeLightscaperNativePhotoLibraryRestoreReadyCurrentV1 as consumeReady } from './lightscaper-native-photo-library-restore-ready-current-v1.ts';
import { id, name } from '../src/lightscaper/catalog/value-validation.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { acquireLightscaperNativePhotoLibraryWriterCurrentV1 as acquire, type LightscaperNativePhotoLibraryWriterCurrentV1 as Writer } from './lightscaper-native-photo-library-writer-current-v1.ts';
import { LightscaperNativePhotoLibraryScopeRegistryCurrentV1 as Registry, type LightscaperNativePhotoLibraryAllocationPageCurrentV1 as Page } from './lightscaper-native-photo-library-scope-registry-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import { LightscaperNativePhotoMediaLifetimeCurrentV1 as Lifetime, checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { openLightscaperNativePhotoLibraryComponentsCurrentV1 as openComponents, openLightscaperNativePhotoLibraryOwnerCurrentV1 as openOwner,
	type LightscaperNativePhotoLibraryComponentsCurrentV1 as Components } from './lightscaper-native-photo-library-components-current-v1.ts';
import { createLightscaperNativePhotoLibraryRestoreCandidateCurrentV1 as createCandidate, type LightscaperNativePhotoLibraryRestoreCandidateCurrentV1 as Candidate } from './lightscaper-native-photo-library-restore-claim-current-v1.ts';

export type LightscaperNativePhotoLibraryScopeCurrentV1 = Readonly<object>;
type Scope = LightscaperNativePhotoLibraryScopeCurrentV1;
type Options = Readonly<{ signal?: AbortSignal }>;
type RestoreOptions = Readonly<{ signal?: AbortSignal; expectedSelectionToken?: string }>;
type Epoch = { readonly token: string; readonly catalogId: string; readonly controller: AbortController; readonly physical: AbortController; active: boolean };
type SessionRole = { readonly epoch: Epoch; readonly controller: AbortController; stopped: boolean; lease?: Readonly<SessionLease> };
type Binding = Readonly<{ allocation: Readonly<Allocation> | null; appDataPath: string; epoch?: Epoch }>;
type Selected = Readonly<{ scope: Scope; catalogId: string; selectionToken: string }>;
type ArchiveOptions = Readonly<{ name: string; signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }>;
// Unknown retirement must never let GC release exclusion while a child may
// still own a native handle. Recovery of this exceptional state needs a restart.
const QUARANTINED = new Set<object>();
const NativeController = AbortController, SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const ABORT = AbortController.prototype.abort;

/** Main-private physical allocation, composition and exclusive fresh restore
 * claims. Registry creation state supplies no ready or deletion authority. */
export class LightscaperNativePhotoLibraryScopesCurrentV1 {
	readonly #appDataPath: string;
	readonly #guard: Writer;
	readonly #registry: Registry;
	readonly #anchor: Settings;
	readonly #selection: SelectionOwner;
	readonly #archives = new Set<Promise<unknown>>();
	#archiveOpening = false;
	#epoch: Epoch | null = null;
	#restorePrevious: Readonly<SelectionSnapshot> | null = null;
	readonly #lifetime = new Lifetime();
	readonly #shutdown = new NativeController();
	readonly #physicalShutdown = new NativeController();
	readonly #sessionOpenings = new Set<Promise<unknown>>();
	#sessionOpening = false;
	#session: SessionRole | null = null;
	readonly #scopes = new WeakMap<object, Binding>();
	readonly #children = new Set<Readonly<Components>>();
	readonly #restoreTokens = new Set<string>();
	#restoreOpening = false;
	#restore: Readonly<Candidate> | null = null;
	#unretired = false;
	#closing: Promise<void> | null = null;
	private constructor(appDataPath: string, guard: Writer, registry: Registry, anchor: Settings) {
		this.#appDataPath = appDataPath; this.#guard = guard; this.#registry = registry; this.#anchor = anchor;
		this.#selection = new SelectionOwner(anchor, registry, appDataPath, () => { this.#assertAccepting(); }, () => { this.#quarantine(); });
		registerArchive(this, Object.freeze<Pick<LightscaperNativePhotoLibraryScopesCurrentV1, 'openSelected' | 'beginRestore' | 'publishRestoreReady'>>({
			openSelected: options => Reflect.apply(ARCHIVE_SELECTED, this, [options]) as ReturnType<typeof ARCHIVE_SELECTED>,
			beginRestore: (catalogId, options) => Reflect.apply(ARCHIVE_BEGIN, this, [catalogId, options]) as ReturnType<typeof ARCHIVE_BEGIN>,
			publishRestoreReady: (ready, options) => Reflect.apply(ARCHIVE_PUBLISH, this, [ready, options]) as ReturnType<typeof ARCHIVE_PUBLISH>,
		}));
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
	openSelected(options: Readonly<{ name: string; signal?: AbortSignal }>): Promise<Selected> {
		try { this.#assertTransitionAvailable(); } catch (error) { return Promise.reject(error); }
		let captured: CapturedOptions | undefined;
		const work = this.#run({}, () => {
			captured = captureOptions(options, ['name', 'signal'], ['name'], this.#shutdown);
			return { name: name(field(captured.input, 'name', 'native library options'), 'native catalog name'), signal: captured.signal };
		}, async input => {
			this.#assertTransitionAvailable(); const current = await this.#selection.open(input.name, input.signal);
			if (this.#epoch && this.#epoch.token !== current.pointer.selectionToken) await this.#retireSelected();
			if (!this.#epoch) this.#epoch = { token: current.pointer.selectionToken, catalogId: current.pointer.catalogId, controller: new NativeController(), physical: new NativeController(), active: true };
			return Object.freeze({ scope: this.#mint({ ...current.binding, epoch: this.#epoch }), catalogId: current.pointer.catalogId, selectionToken: current.pointer.selectionToken });
		}); return finishCapture(work, () => { captured?.detach(); });
	}
	beginRestore(catalogId: string, options: RestoreOptions = {}): Promise<Readonly<Candidate>> {
		try { this.#assertTransitionAvailable(); } catch (error) { return Promise.reject(error); }
		this.#restoreOpening = true;
		let captured: CapturedOptions | undefined, transferred = false;
		const pending = this.#run({}, () => {
			captured = captureOptions(options, ['signal', 'expectedSelectionToken'], [], this.#shutdown);
			const expected = Object.hasOwn(captured.input, 'expectedSelectionToken') ? token(field(captured.input, 'expectedSelectionToken', 'native library options')) : undefined;
			const catalog = id(catalogId, 'native restore catalog ID'); check(captured.signal); return { catalog, expected, signal: captured.signal };
		}, async input => {
			const previous = await this.#selection.open('Library', input.signal);
			if (input.expected !== undefined && previous.pointer.selectionToken !== input.expected) throw new Error('Native selected library changed before restore allocation.');
			await this.#selection.admitRestore(previous, input.signal);
			await this.#retireSelected(); check(input.signal); this.#restorePrevious = previous;
			const candidate = await createCandidate(this.#registry, this, input.catalog, input.signal, Object.freeze({
				assertCurrent: () => { this.#assertAccepting(); }, detach: () => { captured?.detach(); },
				retireRole: () => { this.#restore = null; this.#restorePrevious = null; this.#restoreTokens.delete(candidate.allocation.namespaceToken); },
				quarantine: () => { this.#quarantine(); }
			}));
			this.#restore = candidate; this.#restoreTokens.add(candidate.allocation.namespaceToken); transferred = true;
			try { await this.#selection.stage(candidate.allocation, previous, input.signal); }
			catch (primary) {
				try { await candidate.close(); candidate.retireRole('protected'); }
				catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native restore journal and candidate retirement failed.', { cause: cleanup }); }
				throw primary;
			}
			return candidate;
		});
		return finishCapture(pending, () => { this.#restoreOpening = false; if (!transferred) { this.#restorePrevious = null; captured?.detach(); } });
	}
	publishRestoreReady(value: unknown, options: Options = {}): Promise<Readonly<Publication>> {
		return this.#run(options, signal => {
			if (!this.#restore || !this.#restorePrevious) throw new Error("Native publication requires this manager’s current fresh restore role.");
			const ready = consumeReady(value, this);
			if (JSON.stringify(ready.allocation) !== JSON.stringify(this.#restore.allocation)) throw new Error('Native Ready belongs to another restore role.');
			return { ready, previous: this.#restorePrevious, candidate: this.#restore, signal };
		}, async input => {
			let published = false;
			try { const result = await this.#selection.publish(input.ready, input.previous, input.signal); published = true; return result; }
			finally { input.candidate.retireRole(published ? 'published' : 'protected'); }
		});
	}
	restoreArchive(input: ScapeProjectInput, options: ArchiveOptions): Promise<Readonly<PhotoLibraryRestoreReceiptV1>> {
		try { this.#assertTransitionAvailable(); if (this.#archiveOpening) throw new Error('A native archive restore is already registered.'); }
		catch (error) { return Promise.reject(error); }
		this.#archiveOpening = true; let captured: CapturedOptions | undefined, transferred = false;
		const registration = this.#run({}, () => {
			captured = captureOptions(options, ['name', 'signal', 'readerFactories'], ['name'], this.#shutdown);
			const catalogName = name(field(captured.input, 'name', 'native library options'), 'native catalog name');
			let readerFactories: ScapeProjectInputReaderFactories | undefined;
			try { readerFactories = captureReaders(Object.hasOwn(captured.input, 'readerFactories') ? field(captured.input, 'readerFactories', 'native library options') : undefined); }
			catch (primary) { check(captured.signal); throw primary; }
			check(captured.signal); return { name: catalogName, signal: captured.signal, readerFactories };
		}, admitted => {
			const task = Promise.resolve().then(async () => {
				const runtime = await import('./lightscaper-native-photo-library-archive-restore-current-v1.ts');
				return await runtime.restoreLightscaperNativePhotoLibraryArchiveCurrentV1(this, input, { name: admitted.name, signal: admitted.signal,
					...(admitted.readerFactories === undefined ? {} : { readerFactories: admitted.readerFactories }) });
			});
			this.#archives.add(task); transferred = true;
			const detach = (): void => { this.#archives.delete(task); this.#archiveOpening = false; captured?.detach(); };
			const owned = finishCapture(task, detach); void owned.catch(() => undefined);
			// The queue owns this inert registration only. The real archive task
			// calls ordinary manager APIs without waiting behind its own Promise.
			return Object.freeze({ task: owned });
		});
		return registration.then(packet => packet.task, (primary: unknown) => {
			if (!transferred) { this.#archiveOpening = false; try { captured?.detach(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native archive admission and retirement failed.', { cause: cleanup }); } }
			throw primary;
		});
	}

	resume(namespaceToken: string, options: Options = {}): Promise<Scope> {
		return this.#run(options, () => { const value = token(namespaceToken); this.#assertOrdinaryScope(value); return value; }, async (namespace, signal) => {
			this.#assertOrdinaryScope(namespace); this.#guard.assertCurrent(); return this.#mint(await this.#registry.resume(namespace, signal));
		});
	}
	describe(scope: Scope): Readonly<Allocation> | null { this.#assertAccepting(); return this.#binding(scope).allocation; }
	openComponents(scope: Scope, options: Options = {}): Promise<Readonly<Components>> {
		return this.#run(options, () => {
			this.#assertTransitionAvailable(); const binding = this.#binding(scope);
			if (this.#session) throw new Error('The selected native Session owns component admission.');
			return binding;
		}, (binding, signal) => { this.#assertTransitionAvailable(); return this.#openComponents(binding, signal); });
	}
	async #openComponents(binding: Binding, signal: AbortSignal): Promise<Readonly<Components>> {
		this.#assertBindingCurrent(binding);
		this.#guard.assertCurrent(); check(signal);
		if (binding.allocation) {
			this.#assertOrdinaryScope(binding.allocation.namespaceToken);
			const current = await this.#registry.resume(binding.allocation.namespaceToken, signal);
			if (JSON.stringify(current.allocation) !== JSON.stringify(binding.allocation) || current.appDataPath !== binding.appDataPath) {
				throw new Error('Native library scope no longer matches its actual durable reservation.');
			}
		}
		this.#guard.assertCurrent(); check(signal);
		const opened = await openComponents(binding.appDataPath, signal, () => { this.#quarantine(); },
			Object.freeze({ signal: Reflect.apply(SIGNAL, binding.epoch?.physical ?? this.#physicalShutdown, []) as AbortSignal, assertCurrent: () => { this.#assertBindingCurrent(binding); } }));
		const actualClose = opened.close; let closing: Promise<void> | undefined;
		const components: Readonly<Components> = Object.freeze({ ...opened, close: (): Promise<void> => {
			if (closing) return closing;
			let resolve!: () => void, reject!: (error: unknown) => void;
			closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
			void (async () => { await Reflect.apply(actualClose, opened, []); this.#children.delete(components); })().then(resolve, (error: unknown) => { this.#quarantine(); reject(error); });
			return closing;
		} });
		this.#children.add(components);
		try { this.#guard.assertCurrent(); check(signal); return components; }
		catch (primary) {
			try { await components.close(); }
			catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library component admission and retirement failed.', { cause: cleanup }); }
			throw primary;
		}
	}
	openSessionLease(scope: Scope, localOwner: Readonly<{ close(): Promise<void> }>, options: Options = {}): Promise<Readonly<SessionLease>> {
		try {
			this.#assertTransitionAvailable();
			if (this.#session) throw new Error('A selected native Session already owns this epoch.');
		} catch (error) { return Promise.reject(error); }
		this.#sessionOpening = true;
		let resolve!: (value: Readonly<SessionLease>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Readonly<SessionLease>>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#sessionOpenings.add(pending);
		let captured: CapturedOptions | undefined, role: SessionRole | undefined, components: Readonly<Components> | undefined;
		let closeLocal: (() => Promise<void>) | undefined, lease: Readonly<SessionLease> | undefined;
		const stopRole = (): void => {
			if (!role || role.stopped) return; role.stopped = true;
			Reflect.apply(ABORT, role.controller, [new Error('Native selected Session is stopping.')]);
		};
		const work = this.#lifetime.run({}, () => {
			this.#assertAccepting(); const binding = this.#binding(scope), epoch = binding.epoch;
			if (!epoch || !epoch.active || epoch !== this.#epoch) throw new TypeError('Native Session requires its current selected scope.');
			if (this.#session || this.#children.size) throw new Error('Native components already have an owner.');
			role = { epoch, controller: new NativeController(), stopped: false }; this.#session = role;
			captured = captureOptions(options, ['signal'], [], this.#shutdown, () => {
				// Link native cancellation first, then capture the local retirement
				// before options enumeration can reenter manager shutdown.
				const actualClose: unknown = localOwner.close;
				if (typeof actualClose !== 'function') throw new TypeError('Native Session requires its actual local retirement owner.');
				let localClosing: Promise<void> | undefined;
				closeLocal = () => localClosing ??= Promise.resolve().then(() => Reflect.apply(actualClose, localOwner, []) as Promise<void>);
			});
			check(captured.signal); return binding;
		}, async binding => {
			this.#assertAccepting(); check(captured!.signal);
			// This is our own registered opening, so ordinary transition admission
			// remains fenced while the private constructor opens its actual owners.
			components = await this.#openComponents(binding, captured!.signal);
			const currentRole = role!, actualComponents = components;
			const assertCurrent = (): void => {
				if (currentRole.stopped || this.#session !== currentRole) throw new Error('Native Session role has retired.');
				this.#assertBindingCurrent(binding);
			};
			const claim = sessionClaim(Object.freeze({ catalogId: currentRole.epoch.catalogId, selectionToken: currentRole.epoch.token,
				signal: Reflect.apply(SIGNAL, currentRole.controller, []) as AbortSignal, components: actualComponents, anchor: this.#anchor,
				assertCurrent, stop: stopRole, quarantine: () => { this.#quarantine(); }, release: () => {
					if (this.#children.has(actualComponents)) throw new Error('Native Session cannot release a live physical owner.');
					if (this.#session === currentRole) this.#session = null;
				} }));
			lease = await sessionLease(claim, closeLocal!); currentRole.lease = lease;
			this.#assertAccepting(); check(captured!.signal); return lease;
		});
		void work.then(value => value, async (primary: unknown) => {
			let failure = primary;
			try { check(captured?.signal); check(Reflect.apply(SIGNAL, this.#shutdown, []) as AbortSignal); } catch (reason) { failure = reason; }
			const failures: unknown[] = [];
			try { stopRole(); } catch (error) { failures.push(error); }
			if (lease) { try { await lease.close(); } catch (error) { failures.push(error); } }
			else {
				try { await closeLocal?.(); } catch (error) { failures.push(error); }
				if (!failures.length) { try { await components?.close(); } catch (error) { failures.push(error); } }
				if (!failures.length && this.#session === role) this.#session = null;
			}
			if (failures.length) { this.#quarantine(); throw new AggregateError([failure, ...failures], 'Native Session admission retirement is unproved.', { cause: failures[0] }); }
			throw failure;
		}).then(value => { finish(true, value); }, (error: unknown) => { finish(false, error); });
		const finish = (okay: boolean, result: unknown): void => {
			this.#sessionOpening = false; this.#sessionOpenings.delete(pending);
			try { captured?.detach(); } catch (cleanup) {
				this.#quarantine(); reject(new AggregateError([...(okay ? [] : [result]), cleanup], 'Native Session admission signal retirement failed.', { cause: cleanup })); return;
			}
			if (okay) resolve(result as Readonly<SessionLease>); else reject(result);
		};
		return pending;
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
		const stopFailures: unknown[] = [];
		try { this.#session?.lease?.stop(); } catch (error) { stopFailures.push(error); this.#quarantine(); }
		Reflect.apply(ABORT, this.#shutdown, [new Error('Native library scopes are closing.')]);
		void this.#lifetime.close(async () => {
			await Promise.allSettled([...this.#sessionOpenings, ...this.#archives]);
			// Keep physical ticket signals and the anchor alive through the actual
			// local Session barrier. A failed barrier retains every physical owner.
			await this.#session?.lease?.close();
			if (stopFailures.length || this.#unretired) throw new AggregateError(stopFailures, 'Native Session retirement is unproved; physical owners retained.');
			Reflect.apply(ABORT, this.#physicalShutdown, [new Error('Native library storage is closing.')]);
			if (this.#epoch) Reflect.apply(ABORT, this.#epoch.physical, [new Error('Native selected storage is closing.')]);
			const results = await Promise.allSettled([...[...this.#children].map(async child => { await child.close(); }),
				...(this.#restore ? [(async () => { await this.#restore?.close(); })()] : [])]);
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
	async #retireSelected(): Promise<void> {
		const epoch = this.#epoch; this.#epoch = null;
		if (epoch) { epoch.active = false; Reflect.apply(ABORT, epoch.controller, [new Error('Native selected library is retiring.')]); }
		await this.#session?.lease?.close();
		if (epoch) Reflect.apply(ABORT, epoch.physical, [new Error('Native selected storage is retiring.')]);
		const results = await Promise.allSettled([...this.#children].map(async child => { await child.close(); }));
		const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (failures.length) { this.#quarantine(); throw new AggregateError(failures, 'Native selected component retirement is unproved.'); }
	}
	#assertTransitionAvailable(): void {
		this.#assertAccepting(); if (this.#sessionOpening) throw new Error('A native Session opening owns transition admission.');
		if (this.#restoreOpening || this.#restore) throw new Error('A native restore already owns this manager.');
	}
	#assertBindingCurrent(binding: Binding): void {
		this.#assertAccepting(); if (binding.epoch && (!binding.epoch.active || binding.epoch !== this.#epoch)) throw new Error('Native selected scope has retired.');
	}

	#assertOrdinaryScope(namespace: string): void {
		if (this.#restoreOpening || this.#restoreTokens.has(namespace)) throw new Error('Fresh native restore generations require their exclusive candidate claim.');
	}
	#assertAccepting(): void {
		if (this.#closing || this.#unretired) throw new Error('Native library scopes are closing, closed or quarantined.');
		this.#guard.assertCurrent();
	}
	#quarantine(): void {
		this.#unretired = true; QUARANTINED.add(this.#guard); QUARANTINED.add(this);
		Reflect.apply(ABORT, this.#shutdown, [new Error('Native library scope retirement is unproved.')]);
	}
}
const ARCHIVE_SELECTED = LightscaperNativePhotoLibraryScopesCurrentV1.prototype.openSelected;
const ARCHIVE_BEGIN = LightscaperNativePhotoLibraryScopesCurrentV1.prototype.beginRestore;
const ARCHIVE_PUBLISH = LightscaperNativePhotoLibraryScopesCurrentV1.prototype.publishRestoreReady;
function token(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) throw new TypeError('Native library namespace requires 32 lowercase hexadecimal characters.');
	return value;
}

interface CapturedOptions { readonly input: Readonly<Record<string, unknown>>; readonly signal: AbortSignal; detach(): void }
function captureOptions(value: unknown, allowed: readonly string[], required: readonly string[], shutdown: AbortController, beforeRecord?: () => void): CapturedOptions {
	const manager = Reflect.apply(SIGNAL, shutdown, []) as AbortSignal; check(manager);
	let linked: ReturnType<typeof link> | undefined, caller: AbortSignal | undefined;
	try {
		const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
		const supplied: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		if (supplied !== undefined) { assertPhotoStackQuerySignalV1(supplied); caller = supplied; }
		linked = link(caller, manager); check(linked.signal);
		beforeRecord?.(); check(linked.signal);
		const input = record(value, 'native library options', allowed, required);
		if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'native library options') : undefined) !== caller) throw new TypeError('Native library signal changed during admission.');
		const inert: Record<string, unknown> = {};
		for (const key of allowed) if (Object.hasOwn(input, key)) inert[key] = field(input, key, 'native library options');
		check(linked.signal); return Object.freeze({ input: Object.freeze(inert), signal: linked.signal, detach: linked.detach });
	} catch (primary) {
		let failure = primary; try { check(linked?.signal ?? caller); check(manager); } catch (reason) { failure = reason; }
		try { linked?.detach(); } catch (cleanup) { throw new AggregateError([failure, cleanup], 'Native library option admission and signal retirement failed.', { cause: cleanup }); }
		throw failure;
	}
}
function finishCapture<Result>(work: Promise<Result>, detach: () => void): Promise<Result> {
	return work.then(value => { detach(); return value; }, (primary: unknown) => {
		try { detach(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library work and signal retirement failed.', { cause: cleanup }); } throw primary;
	});
}
