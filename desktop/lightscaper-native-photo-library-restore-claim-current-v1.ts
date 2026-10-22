/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { normalizePhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { LightscaperNativePhotoLibraryScopeRegistryCurrentV1 as Registry } from './lightscaper-native-photo-library-scope-registry-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

export type LightscaperNativePhotoLibraryRestoreClaimCurrentV1 = Readonly<object>;
export type LightscaperNativePhotoLibraryRestoreRoleCurrentV1 = 'published' | 'unpublished' | 'protected';
export interface LightscaperNativePhotoLibraryRestoreBindingCurrentV1 {
	readonly allocation: Readonly<Allocation>; readonly appDataPath: string; readonly signal: AbortSignal; assertCurrent(): void;
}
export interface LightscaperNativePhotoLibraryRestoreCandidateCurrentV1 {
	readonly allocation: Readonly<Allocation>;
	readonly catalogClaim: LightscaperNativePhotoLibraryRestoreClaimCurrentV1;
	readonly mediaClaim: LightscaperNativePhotoLibraryRestoreClaimCurrentV1;
	close(): Promise<void>;
	retireRole(kind: LightscaperNativePhotoLibraryRestoreRoleCurrentV1): void;
}
interface State {
	readonly allocation: Readonly<Allocation>; readonly appDataPath: string; readonly registryOwner: string; readonly manifestSha256: string; readonly owner: object;
	readonly controller: AbortController; readonly signal: AbortSignal; readonly detach: () => void;
	readonly assert: () => void; readonly retireRole: (kind: LightscaperNativePhotoLibraryRestoreRoleCurrentV1) => void; readonly quarantine: () => void;
	readonly active: Set<Promise<unknown>>; readonly children: Set<() => Promise<void>>; readonly unknownOwners: Set<unknown>; readonly failures: unknown[];
	closing: Promise<void> | null; retired: boolean; roleRetired: boolean;
}
type Claim = { state: State; component: 'catalog' | 'media'; used: boolean };
const claims = new WeakMap<object, Claim>(), candidates = new WeakMap<object, State>(), cleanupFailures = new WeakSet<object>();
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const ALLOCATE = Registry.prototype.allocate, IDENTITY = Registry.prototype.readRestoreIdentityCurrentV1;
function stateFor(value: unknown): State {
	const state = value !== null && typeof value === 'object' ? candidates.get(value) : undefined;
	if (!state) throw new TypeError('Native restore requires its genuine manager-created fresh candidate.'); return state;
}
function current(state: State): void { if (state.roleRetired) throw new Error('Native restore role has retired.'); state.assert(); }
function unretired(state: State, error: unknown): void { state.failures.push(error); state.quarantine(); }
function cleanupWitness(error: unknown): boolean { return error !== null && typeof error === 'object' && cleanupFailures.has(error); }
/** Fixed main-private constructors call this only after their own exact native
 * cleanup witness or an actual acquired owner's close failure. Borrowed errors
 * never acquire authority merely by being AggregateError instances. */
export function markLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1(value: unknown): void {
	if (value === null || typeof value !== 'object') throw new TypeError('Native restore cleanup witness requires its actual issued failure.');
	cleanupFailures.add(value);
}
export function createLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1(primary: unknown, cleanup: unknown, message: string): AggregateError {
	const failure = new AggregateError([primary, cleanup], message, { cause: cleanup }); markLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1(failure); return failure;
}

/** Main-private creator invokes the actual Registry allocator with fresh native
 * tokens. No caller allocation, path or ordinary active DB can be substituted. */
export async function createLightscaperNativePhotoLibraryRestoreCandidateCurrentV1(registry: Registry, owner: object, catalogId: string,
	signal: AbortSignal, hooks: Readonly<{ assertCurrent(): void; detach(): void; retireRole(kind: LightscaperNativePhotoLibraryRestoreRoleCurrentV1): void; quarantine(): void }>): Promise<Readonly<LightscaperNativePhotoLibraryRestoreCandidateCurrentV1>> {
	check(signal); hooks.assertCurrent(); const namespaceToken = randomBytes(16).toString('hex');
	let ownerToken: string; do { ownerToken = randomBytes(16).toString('hex'); } while (ownerToken === namespaceToken);
	const allocation = normalizePhotoLibraryRestoreAllocationV1({ schemaVersion: 1, kind: 'photo-library-restore-allocation', operationId: namespaceToken, namespaceToken, ownerToken, catalogId });
	const generation = await Reflect.apply(ALLOCATE, registry, [allocation, signal]) as Awaited<ReturnType<Registry['allocate']>>;
	check(signal); hooks.assertCurrent(); const identity = Reflect.apply(IDENTITY, registry, [allocation]) as ReturnType<Registry['readRestoreIdentityCurrentV1']>;
	const controller = new NativeController(), shutdown = Reflect.apply(SIGNAL, controller, []) as AbortSignal, linked = link(signal, shutdown);
	const state: State = { allocation, appDataPath: generation.appDataPath, registryOwner: identity.registryOwner, manifestSha256: identity.manifestSha256, owner,
		controller, signal: linked.signal, detach: () => { const errors: unknown[] = []; try { linked.detach(); } catch (error) { errors.push(error); }
			try { hooks.detach(); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, 'Native restore signal retirement failed.'); },
		assert: hooks.assertCurrent, retireRole: hooks.retireRole, quarantine: hooks.quarantine,
		active: new Set(), children: new Set(), unknownOwners: new Set(), failures: [], closing: null, retired: false, roleRetired: false };
	const catalogClaim = Object.freeze({}), mediaClaim = Object.freeze({});
	claims.set(catalogClaim, { state, component: 'catalog', used: false }); claims.set(mediaClaim, { state, component: 'media', used: false });
	const candidate = Object.freeze({ allocation, catalogClaim, mediaClaim, close: (): Promise<void> => close(state),
		retireRole: (kind: LightscaperNativePhotoLibraryRestoreRoleCurrentV1): void => {
			if (!['published', 'unpublished', 'protected'].includes(kind) || !state.retired || state.failures.length) throw new Error('Native restore role requires proven joined retirement.');
			if (state.roleRetired) return; state.roleRetired = true; state.retireRole(kind);
		} }); candidates.set(candidate, state); return candidate;
}

/** Claim consumption and accepted constructor registration precede the first
 * callback. Both purpose and object identity are checked without Proxy reads. */
export async function openLightscaperNativePhotoLibraryRestoreComponentCurrentV1<Owner extends { close(): Promise<void> }>(value: unknown,
	component: 'catalog' | 'media', open: (binding: Readonly<LightscaperNativePhotoLibraryRestoreBindingCurrentV1>) => Promise<Owner>): Promise<Owner> {
	const claim = value !== null && typeof value === 'object' ? claims.get(value) : undefined;
	if (!claim || claim.used || claim.component !== component || claim.state.closing) throw new TypeError('Native restore requires its unused purpose-bound fresh claim.');
	const state = claim.state; current(state); check(state.signal); claim.used = true;
	let resolve!: (owner: Owner) => void, reject!: (error: unknown) => void;
	const pending = new Promise<Owner>((accept, refuse) => { resolve = accept; reject = refuse; }); state.active.add(pending);
	void (async () => {
		let owner: Owner | undefined, retire: (() => Promise<void>) | undefined;
		try {
			if (typeof open !== 'function') throw new TypeError('Native restore component requires its fixed owning constructor.');
			owner = await Reflect.apply(open, undefined, [Object.freeze({ allocation: state.allocation, appDataPath: state.appDataPath, signal: state.signal,
				assertCurrent: () => { current(state); check(state.signal); } })]) as Owner;
			state.unknownOwners.add(owner); const actualClose = owner.close; if (typeof actualClose !== 'function') throw new TypeError('Native restore component must own joined close.');
			const actual = owner; retire = () => Reflect.apply(actualClose, actual, []) as Promise<void>; state.children.add(retire); state.unknownOwners.delete(owner);
			current(state); check(state.signal); if (state.closing) throw new Error('Native restore candidate closed during component opening.'); return owner;
		} catch (primary) {
			if (retire) { try { await retire(); state.children.delete(retire); } catch (cleanup) { unretired(state, cleanup); throw new AggregateError([primary, cleanup], 'Native restore opening and retirement failed.', { cause: cleanup }); } }
			else if (owner !== undefined || cleanupWitness(primary)) unretired(state, primary);
			throw primary;
		}
	})().then(owner => { state.active.delete(pending); resolve(owner); }, (error: unknown) => { state.active.delete(pending); reject(error); });
	return await pending;
}
function close(state: State): Promise<void> {
	if (state.closing) return state.closing;
	let resolve!: () => void, reject!: (error: unknown) => void;
	state.closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
	try { Reflect.apply(ABORT, state.controller, [new Error('Native restore candidate is closing.')]); } catch (error) { unretired(state, error); }
	void Promise.allSettled([...state.active]).then(async () => {
		const results = await Promise.allSettled([...state.children].map(async retire => { await retire(); }));
		for (const result of results) if (result.status === 'rejected') unretired(state, result.reason);
		try { state.detach(); } catch (error) { unretired(state, error); }
		if (state.failures.length) throw new AggregateError(state.failures, 'Native restore candidate retirement is unproved; files retained.');
		state.children.clear(); state.retired = true;
	}).then(resolve, reject); return state.closing;
}
export function inspectLightscaperNativePhotoLibraryRestoreCandidateCurrentV1(value: unknown) {
	const state = stateFor(value);
	return Object.freeze({ allocation: state.allocation, registryOwner: state.registryOwner, manifestSha256: state.manifestSha256, owner: state.owner,
		assertRetired: (): void => { if (!state.retired || state.failures.length) throw new Error('Native restore candidate has no successful joined retirement.'); },
		assertCurrent: (): void => { current(state); } });
}
