/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import { captureLightscaperNativePhotoGrantedFilesystemCurrentV1 as captureFilesystem,
	lightscaperNativePhotoGrantedFilesystemRetirementIsUnprovedCurrentV1 as nativeUnproved,
	type LightscaperNativePhotoGrantedFilesystemCurrentV1 as FilesystemOwner, type NativePath, type NativeFileIdentity } from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { captureIdentity } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import { openLightscaperNativePhotoLinkedGrantDatabaseCurrentV1 as openDatabase } from './lightscaper-native-photo-linked-grants-files-current-v1.ts';
import { captureLinkedGrantNamespaceCurrentV1 as namespace, assertLinkedGrantNamespaceCurrentV1 as sameNamespace, readLinkedGrantNamespaceCurrentV1 as boundNamespace,
	type LinkedGrantNamespaceCurrentV1 as Namespace } from './lightscaper-native-photo-linked-grants-binding-current-v1.ts';
import { captureLinkedGrantSelectionCurrentV1 as selection, linkedGrantIdCurrentV1 as id, readLinkedGrantCurrentV1 as read,
	readLinkedGrantSummaryCurrentV1 as summary, readLinkedGrantPageCurrentV1 as page, insertLinkedGrantCurrentV1 as insert,
	revokeLinkedGrantCurrentV1 as revoke, type LightscaperNativePhotoLinkedGrantCurrentV1 as Grant } from './lightscaper-native-photo-linked-grants-records-current-v1.ts';
import { LinkedGrantLifetimeCurrentV1 as Lifetime, captureLinkedGrantSignalCurrentV1 as signal, checkLinkedGrantSignalCurrentV1 as checkSignal,
	type LinkedGrantOperationCurrentV1 as Operation } from './lightscaper-native-photo-linked-grants-lifetime-current-v1.ts';
import { createLinkedGrantCleanupFailureCurrentV1 as cleanup, linkedGrantCleanupIsUnprovedCurrentV1 as unproved,
	retainLinkedGrantCleanupCurrentV1 as retain, combineLinkedGrantFailuresCurrentV1 as combine } from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
export type { LightscaperNativePhotoLinkedGrantCurrentV1 } from './lightscaper-native-photo-linked-grants-records-current-v1.ts';
type Options = Readonly<{ signal?: AbortSignal }>;
type Scope = Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
type Selection = Readonly<{ path: NativePath; displayName: string }>;
type Chooser = Readonly<{ chooseRoot(signal?: AbortSignal): Promise<Selection | null> }>;
type Facet = ReturnType<typeof captureFilesystem>;
type Root = Awaited<ReturnType<Facet['openRoot']>>;
interface Opening { readonly appDataPath: string; readonly mediaPath: string; readonly facet: Facet; readonly scope: Scope; readonly choose: (signal: AbortSignal) => Promise<unknown>; readonly notify: () => void }
export interface LightscaperNativePhotoLinkedGrantOptionsCurrentV1 {
	readonly appDataPath: string; readonly filesystem: FilesystemOwner; readonly chooser: Chooser; readonly scope: Scope; unretired(): void;
}
/** Main-only local folder authorization. Scalar rows never become Photo/body
 * proof. Each operation closes only roots it actually opened, not the shared role. */
export class LightscaperNativePhotoLinkedGrantsCurrentV1 {
	readonly #db: DatabaseSync; readonly #opening: Opening; readonly #binding: Namespace; readonly #life: Lifetime;
	readonly #roots = new Set<Readonly<{ root: Root; close(): Promise<void> }>>();
	readonly #revoking = new Map<string, Operation>();
	private constructor(db: DatabaseSync, opening: Opening, binding: Namespace) {
		this.#db = db; this.#opening = opening; this.#binding = binding; this.#life = new Lifetime(opening.scope.signal, opening.notify, this); Object.freeze(this);
	}
	static async open(options: LightscaperNativePhotoLinkedGrantOptionsCurrentV1): Promise<LightscaperNativePhotoLinkedGrantsCurrentV1> {
		const opening = captureOpening(options); let db: DatabaseSync | undefined;
		try {
			checkOpening(opening); const binding = await namespace(opening.mediaPath); checkOpening(opening);
			db = await openDatabase(opening.appDataPath, binding); checkOpening(opening);
			sameNamespace(binding, await namespace(opening.mediaPath)); checkOpening(opening);
			return new LightscaperNativePhotoLinkedGrantsCurrentV1(db, opening, binding);
		} catch (primary) {
			let failure: unknown = primary;
			if (db) { try { db.close(); } catch (error) { retain(db); failure = cleanup([primary, error], 'Native grant opening and SQLite close failed.'); } }
			if (unproved(failure) || nativeUnproved(failure)) {
				retain({ db, opening }); try { opening.notify(); } catch (error) { failure = combine([failure, error], 'Native grant opening quarantine notification failed.'); }
			}
			throw failure;
		}
	}
	readonly authorize = (options?: Options): Promise<Readonly<Grant> | null> => this.#life.run(false, options, entry => {
		entry.grantId = randomBytes(32).toString('hex'); return entry.grantId;
	}, async (grantId, entry) => {
		await this.#verify(entry); const chosen = await this.#opening.choose(entry.signal); this.#check(entry);
		if (chosen === null) return null; const selected = selection(chosen);
		const identity = await this.#root(entry, selected.path, null, root => captureIdentity(root.identity));
		await this.#verify(entry);
		return insert(this.#db, grantId, selected, identity, () => { this.#check(entry); boundNamespace(this.#db, this.#binding); }, () => { entry.acknowledged = true; });
	});
	readonly revalidate = (grantId: string, options?: Options): Promise<Readonly<Grant> | null> => this.#life.run(false, options, entry => {
		entry.grantId = id(grantId); return entry.grantId;
	}, async (grantId, entry) => {
		await this.#verify(entry); const initial = summary(this.#db, grantId); if (!initial || initial.revoked) return initial;
		const stored = read(this.#db, grantId); if (!stored || stored.grant.revoked) return stored?.grant ?? null;
		if (stored.grant.revision !== initial.revision) throw new Error('Native grant changed before revalidation.');
		await this.#root(entry, stored.path, stored.identity, () => undefined); await this.#verify(entry);
		const current = summary(this.#db, grantId);
		if (current && !current.revoked && current.revision !== initial.revision) throw new Error('Native grant changed during revalidation.'); return current;
	});
	readonly readPage = (afterGrantId: string | null = null, options?: Options): Promise<Readonly<{ grants: readonly Readonly<Grant>[]; afterGrantId: string | null }>> =>
		this.#life.run(false, options, () => afterGrantId === null ? null : id(afterGrantId), async (after, entry) => { await this.#verify(entry); return page(this.#db, after); });
	readonly revoke = (grantId: string, options?: Options): Promise<boolean> => this.#life.run(true, options, entry => {
		entry.grantId = id(grantId); return entry.grantId;
	}, async (grantId, entry) => {
		if (this.#revoking.has(grantId)) throw new Error('Native grant revocation is busy.'); this.#revoking.set(grantId, entry);
		try {
			await this.#life.cancelGrant(grantId, entry); await this.#verify(entry);
			return revoke(this.#db, grantId, () => { this.#check(entry); boundNamespace(this.#db, this.#binding); }, () => { entry.acknowledged = true; });
		} finally { if (this.#revoking.get(grantId) === entry) this.#revoking.delete(grantId); }
	});
	readonly close = (): Promise<void> => this.#life.close(() => {
		try { this.#db.close(); } catch (error) { throw cleanup([error], 'Native grant SQLite retirement failed.'); }
	});
	#check(entry: Operation): void {
		this.#life.check(entry);
		try { checkOpening(this.#opening); } catch (error) { if (nativeUnproved(error)) this.#life.fail(error); throw error; }
		this.#life.check(entry);
		if (entry.grantId && this.#revoking.has(entry.grantId) && this.#revoking.get(entry.grantId) !== entry) throw new Error('Native grant is being revoked.');
	}
	async #verify(entry: Operation): Promise<void> {
		this.#check(entry); sameNamespace(this.#binding, await namespace(this.#opening.mediaPath)); this.#check(entry);
		if (this.#db.isTransaction) throw new Error('Native grant verification refuses an active transaction.'); boundNamespace(this.#db, this.#binding);
	}
	async #root<Result>(entry: Operation, path: NativePath, expected: NativeFileIdentity | null, read: (root: Root) => Result): Promise<Result> {
		this.#check(entry); let root: Root;
		try {
			// A per-grant abort must not terminate the shared FS peer. Join the
			// accepted real open, then locally fence and privately close its root.
			root = await this.#opening.facet.openRoot(path, expected);
		} catch (error) { if (nativeUnproved(error)) this.#life.fail(error); throw error; }
		const method = root.close, owned = Object.freeze({ root, close: (): Promise<void> => Reflect.apply(method, root, []) as Promise<void> });
		this.#roots.add(owned); let value!: Result, primary: unknown, failed = false;
		try { this.#check(entry); value = read(root); } catch (error) { primary = error; failed = true; }
		try { await owned.close(); }
		catch (error) { const failure = cleanup([...(failed ? [primary] : []), error], 'Native grant root retirement is unproved.'); this.#life.fail(failure); throw failure; }
		this.#roots.delete(owned); if (failed) throw primary; return value;
	}
}
function own(value: unknown, key: string): unknown {
	if (value === null || typeof value !== 'object') throw new TypeError('Native grant open requires own options.');
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('Native grant open requires inert own fields.'); return descriptor.value;
}
function captureOpening(value: unknown): Opening {
	const appDataPath = own(value, 'appDataPath'); if (typeof appDataPath !== 'string') throw new TypeError('Native grant appData must be a string.');
	const mediaPath = deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).databasePath;
	// Genuine role WeakMap admission precedes chooser/scope reflection.
	const facet = captureFilesystem(own(value, 'filesystem'), mediaPath);
	const options = record(value, 'native grant open options', ['appDataPath', 'filesystem', 'chooser', 'scope', 'unretired']);
	const chooser = field(options, 'chooser', 'native grant open options'), chosen = record(chooser, 'native grant chooser', ['chooseRoot']);
	const choose = field(chosen, 'chooseRoot', 'native grant chooser');
	const scope = field(options, 'scope', 'native grant open options'), scoped = record(scope, 'native grant scope', ['signal', 'assertCurrent']);
	const selectedSignal = signal(field(scoped, 'signal', 'native grant scope')), assert = field(scoped, 'assertCurrent', 'native grant scope');
	const notify = field(options, 'unretired', 'native grant open options');
	if (typeof choose !== 'function' || typeof assert !== 'function' || typeof notify !== 'function') throw new TypeError('Native grant trusted capabilities are incomplete.');
	return Object.freeze({ appDataPath, mediaPath, facet, scope: Object.freeze({ signal: selectedSignal, assertCurrent: (): void => { Reflect.apply(assert, scope, []); } }),
		choose: (signal: AbortSignal): Promise<unknown> => Promise.resolve(Reflect.apply(choose, chooser, [signal]) as unknown), notify: (): void => { Reflect.apply(notify, value, []); } });
}
function checkOpening(opening: Opening): void { checkSignal(opening.scope.signal); opening.facet.assertCurrent(); opening.scope.assertCurrent(); checkSignal(opening.scope.signal); }
