/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, mkdtemp, open, realpath, rm, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from './lightscaper-native-catalog-database-current-v1.ts';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { canonicalPhotoDocumentJsonV1 } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { readPhotoSmartCollectionSignalOptionsV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { integer } from '../src/lightscaper/catalog/value-validation.ts';

declare const permitBrand: unique symbol;
export interface LightscaperNativeSmartCollectionRestoreCandidatePermitCurrentV1 { readonly [permitBrand]: true }
export interface LightscaperNativeSmartCollectionRestoreCandidateCurrentV1 {
	readonly database: DatabaseSync;
	readonly permit: LightscaperNativeSmartCollectionRestoreCandidatePermitCurrentV1;
	readonly directory: string;
	close(): Promise<void>;
}
interface Binding {
	readonly database: DatabaseSync;
	readonly controller: AbortController;
	readonly registered: Promise<void>;
	readonly registrationDone: () => void;
	closing: boolean;
	claimed: boolean;
	retire: (() => Promise<void>) | null;
}
export interface LightscaperNativeSmartCollectionRestoreCandidateLeaseCurrentV1 {
	readonly database: DatabaseSync;
	readonly signal: AbortSignal;
	registerRetire(retire: () => Promise<void>): void;
}
const permits = new WeakMap<object, Binding>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const nativeIsOpen = (() => { const db = new DatabaseSync(':memory:', { open: false }); return Object.getOwnPropertyDescriptor(db, 'isOpen')!.get!; })();

/** Main-private candidate creator. It exclusively owns a new private directory
 * and wx0600 file; callers cannot substitute an existing active database.
 * Root/index alone are staged here. No library pointer, Photo bodies, namespace
 * selection, media readiness or complete archive restore is published. */
export async function createLightscaperNativeSmartCollectionRestoreCandidateCurrentV1(stagingParent: string, rootValue: unknown,
	indexRevisionValue: number, options: unknown = {}): Promise<LightscaperNativeSmartCollectionRestoreCandidateCurrentV1> {
	// Detach before the first filesystem await, including the entire root.
	const root = readValidatedPhotoCatalogRootV1(rootValue), document = canonicalPhotoDocumentJsonV1(root);
	const indexRevision = integer(indexRevisionValue, 0, Number.MAX_SAFE_INTEGER, 'private candidate index revision');
	const signal = readPhotoSmartCollectionSignalOptionsV1(options).signal;
	check(signal); if (typeof stagingParent !== 'string' || !isAbsolute(stagingParent)) throw new TypeError('Private staging parent must be an absolute canonical directory.');
	const parent = await realpath(stagingParent), info = await lstat(parent); check(signal);
	if (resolve(stagingParent) !== parent || !info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Private staging parent must be its real canonical directory.');
	let directory: string | undefined, reserved: FileHandle | undefined, database: DatabaseSync | undefined;
	try {
		directory = await mkdtemp(join(parent, 'lightscaper-saved-restore-')); check(signal);
		const databasePath = join(directory, 'saved-candidate.sqlite3'); reserved = await open(databasePath, 'wx', 0o600); check(signal);
		await reserved.close(); reserved = undefined; check(signal);
		database = new DatabaseSync(databasePath, { allowExtension: false }); initializeLightscaperNativeCatalogDatabaseCurrentV1(database); check(signal);
		database.prepare('INSERT INTO native_photo_catalogs(id,document,root_revision,photo_count,index_revision) VALUES(?,?,?,?,?)')
			.run(root.id, document, root.revision, root.photoCount, indexRevision);
		check(signal); return ownCandidate(database, directory);
	} catch (error) {
		const failures: unknown[] = [error];
		if (reserved !== undefined) { try { await reserved.close(); } catch (cleanup) { failures.push(cleanup); } }
		if (database !== undefined) { try { database.close(); } catch (cleanup) { failures.push(cleanup); } }
		// Keep files whenever a handle retirement failed; the caller receives
		// every cause and must wait for process retirement before external cleanup.
		if (directory !== undefined && failures.length === 1) { try { await rm(directory, { recursive: true, force: false }); } catch (cleanup) { failures.push(cleanup); } }
		if (failures.length > 1) throw new AggregateError(failures, 'Private saved candidate initialization and cleanup failed.', { cause: error }); throw error;
	}
}

/** Fixed stage composition only: membership in this WeakMap proves this exact
 * connection came from our exclusive new-file creator. Claim is single-use and
 * registers before any borrowed archive context or options can reenter. */
export function claimLightscaperNativeSmartCollectionRestoreCandidateCurrentV1(value: unknown): LightscaperNativeSmartCollectionRestoreCandidateLeaseCurrentV1 {
	const binding = value !== null && typeof value === 'object' ? permits.get(value) : undefined;
	if (!binding || binding.closing || binding.claimed || Reflect.apply(nativeIsOpen, binding.database, []) !== true) throw new TypeError('Private saved restore requires its live unused fresh-candidate permit.');
	binding.claimed = true;
	return Object.freeze({ database: binding.database, signal: binding.controller.signal, registerRetire: (retire: () => Promise<void>) => {
		if (binding.retire !== null) throw new TypeError('Private saved candidate already registered its stage retirement.');
		binding.retire = retire; binding.registrationDone();
	} });
}
function ownCandidate(database: DatabaseSync, directory: string): LightscaperNativeSmartCollectionRestoreCandidateCurrentV1 {
	let registrationDone: () => void = () => undefined;
	const registered = new Promise<void>(resolveDone => { registrationDone = resolveDone; });
	const binding: Binding = { database, controller: new AbortController(), registered, registrationDone, closing: false, claimed: false, retire: null };
	const permit = Object.freeze({}) as LightscaperNativeSmartCollectionRestoreCandidatePermitCurrentV1; permits.set(permit, binding);
	let closing: Promise<void> | null = null;
	const close = (): Promise<void> => {
		if (closing !== null) return closing;
		binding.closing = true;
		closing = Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			if (binding.claimed) { await binding.registered; try { await binding.retire?.(); } catch (error) { failures.push(error); } }
			try { if (Reflect.apply(nativeIsOpen, database, []) === true) database.close(); } catch (error) { failures.push(error); }
			if (failures.length === 0) { try { await rm(directory, { recursive: true, force: false }); } catch (error) { failures.push(error); } }
			if (failures.length) throw new AggregateError(failures, 'Private saved candidate close failed; owned files are retained.');
		});
		binding.controller.abort(new Error('Private saved candidate closed.')); return closing;
	};
	return Object.freeze({ database, permit, directory, close });
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
