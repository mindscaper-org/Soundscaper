/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import { motionDigest, motionId, motionInteger, motionRecord, motionString } from '../common/editor/motion-values.ts';
import { openMotionProjectDatabase } from '../common/editor/storage/motion-project-database.ts';
import { reclaimExpiredMotionStaging } from '../common/editor/storage/motion-asset-staging.ts';
import { MotionAssetRepository, type MotionAssetStaging } from '../common/editor/storage/motion-asset-repository.ts';
import { request, transact } from '../common/media/indexeddb.ts';
import { editorProjectStorageProfileNames } from '../common/editor/storage/project-storage-profile.ts';
import { bindEditorProjectStoreProfile } from '../common/editor/storage/project-store-profile-binding.ts';
import { MOTIONSCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';
import { createMotionscaperRevision, verifyMotionscaperRevision, type MotionscaperRevision } from './editor-project-revision.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionArchiveImportTransaction } from './editor-scape.ts';
import type { MotionSaveFileReceipt, MotionRecoveredPublication } from './desktop-file-contract.ts';
import { MOTION_NATIVE_SAVE_STORE, assertNativeSaveReceipt, readPreparedNativeSave, type MotionPreparedNativeSave } from './editor-native-save.ts';
import { MotionProjectConflictError, MotionProjectWriteLeases, MOTION_PROJECT_LEASE_STORE, type MotionProjectWriteLease } from './editor-project-write-lease.ts';
export { MotionProjectConflictError, MotionProjectLeaseError } from './editor-project-write-lease.ts';

interface ProjectPointer {
	readonly id: string; readonly savedDigest: string | null;
	readonly recovery: MotionscaperProject | null;
	readonly savedTitle: string | null;
	readonly savedRevision: number | null;
	readonly nativeSaveId?: string;
}
interface StoredRevision { readonly key: string; readonly projectId: string; readonly snapshot: MotionscaperRevision }
export interface MotionscaperProjectStoreOptions { readonly indexedDB?: IDBFactory; readonly now?: () => number }
export interface MotionProjectImportState {
	readonly saved: MotionscaperRevision | null; readonly recovery: MotionscaperProject | null;
	readonly savedDigest: string | null; readonly recoveryDigest: string | null;
}
export interface MotionProjectImportPublication {
	readonly recovery: true; readonly expected: MotionProjectImportState;
}
export interface MotionProjectSummary {
	readonly id: string; readonly title: string; readonly revision: number;
	readonly savedDigest: string | null; readonly hasRecovery: boolean;
}

export function createMotionscaperProjectStore(options: MotionscaperProjectStoreOptions = {}): MotionscaperProjectStore {
	return new MotionscaperProjectStore(options);
}

/** Durable scene snapshots; recovery writes do not publish saved revisions. */
export class MotionscaperProjectStore {
	readonly #databasePromise: Promise<IDBDatabase>;
	readonly #assets: MotionAssetRepository;
	readonly #leases: MotionProjectWriteLeases;
	readonly #listeners = new Set<(revision: MotionscaperRevision) => void>();
	#closed = false;
	#closing: Promise<void> | null = null;
	#databaseClosed = false;

	constructor(options: MotionscaperProjectStoreOptions) {
		const indexedDB = options.indexedDB ?? globalThis.indexedDB;
		if (!indexedDB) throw new Error('Motionscaper requires durable browser storage.');
		bindEditorProjectStoreProfile(this, MOTIONSCAPER_PROJECT_STORAGE_PROFILE);
		this.#databasePromise = openMotionProjectDatabase(indexedDB,
			editorProjectStorageProfileNames(MOTIONSCAPER_PROJECT_STORAGE_PROFILE).databaseName).then(async (database) => {
			try { await reclaimExpiredMotionStaging(database); return database; }
			catch (error) { database.close(); throw error; }
		});
		this.#assets = new MotionAssetRepository(() => this.#database());
		this.#leases = new MotionProjectWriteLeases({ database: () => this.#databasePromise, physicalLocks: indexedDB === globalThis.indexedDB,
			now: options.now, canAcquire: () => !this.#closed && this.#closing === null });
	}

	async #database(): Promise<IDBDatabase> {
		if (this.#closed) throw new Error('Motion project store is closed.');
		return this.#databasePromise;
	}

	async close(): Promise<void> {
		if (this.#databaseClosed) return;
		this.#closing ??= (async () => {
			const database = await this.#databasePromise;
			if (await transact(database, [MOTION_NATIVE_SAVE_STORE], 'readonly', stores => request(stores[MOTION_NATIVE_SAVE_STORE]!.count()))) {
				throw new Error('Resolve the interrupted native Save before closing its project store.');
			}
			this.#closed = true; this.#listeners.clear();
			await this.#leases.close();
			(await this.#databasePromise).close(); this.#databaseClosed = true;
		})();
		try { await this.#closing; } finally { this.#closing = null; }
	}
	acquireWriteAccess(id: string): Promise<MotionProjectWriteLease> { return this.#leases.acquire(id); }
	async releaseWriteAccess(lease: MotionProjectWriteLease): Promise<void> {
		if (await this.loadNativeSave(lease.projectId)) throw new Error('Resolve the native Save before releasing its write access.');
		await this.#leases.release(lease);
	}
	async assertWriteAccess(lease: MotionProjectWriteLease): Promise<void> {
		const database = await this.#database();
		await transact(database, [MOTION_PROJECT_LEASE_STORE], 'readonly', stores => this.#leases.assert(stores, lease));
	}

	subscribeSaved(listener: (revision: MotionscaperRevision) => void): () => void {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	}

	async save(value: unknown, expectedDigest: string | null, lease?: MotionProjectWriteLease): Promise<MotionscaperRevision> {
		const snapshot = createMotionscaperRevision(value);
		await this.#publish(snapshot, expectedDigest, [], lease);
		this.#notify(snapshot);
		return snapshot;
	}

	async #publish(snapshot: MotionscaperRevision, expectedDigest: string | null, staging: readonly MotionAssetStaging[], authority?: MotionProjectWriteLease, imported?: MotionProjectImportPublication | true, native?: Readonly<{ type: 'prepare' | 'publish'; record: MotionPreparedNativeSave; recovering?: boolean }>): Promise<boolean> {
		if (expectedDigest !== null) motionDigest(expectedDigest);
		const database = await this.#database();
		const lease = authority ?? await this.#leases.defaultLease(snapshot.projectId);
		if (lease.projectId !== snapshot.projectId) throw new MotionProjectConflictError();
		return transact(database, ['projects', 'revisions', 'assets', 'chunks', 'staging', MOTION_PROJECT_LEASE_STORE, MOTION_NATIVE_SAVE_STORE], 'readwrite', async (stores) => {
			await this.#leases.assert(stores, lease, true);
			const prior: unknown = await request(stores.projects.get(snapshot.projectId));
			const pointer = prior === undefined ? null : readPointer(prior, snapshot.projectId);
			if (pointer?.nativeSaveId && pointer.nativeSaveId !== native?.record.id) throw new MotionProjectConflictError('Resolve the prepared native Save before changing this project.');
			if (native?.type === 'publish' && !pointer?.nativeSaveId && pointer?.savedDigest === snapshot.digest) return false;
			if ((pointer?.savedDigest ?? null) !== expectedDigest) throw new MotionProjectConflictError();
			if (imported === true && pointer || imported && imported !== true && (!pointer ||
				(pointer.recovery ? createMotionscaperRevision(pointer.recovery).digest : null) !== imported.expected.recoveryDigest)) throw new MotionProjectConflictError();
			if (pointer?.savedDigest) {
				const previous = readRevision(await request(stores.revisions.get(revisionKey(snapshot.projectId, pointer.savedDigest))), snapshot.projectId, pointer.savedDigest);
				assertSavedPointer(pointer, previous);
				if (snapshot.digest !== previous.digest && snapshot.revision <= previous.revision) {
					throw new RangeError('Saved motion revisions must increase after an edit.');
				}
			}
			if (native?.type === 'publish') {
				const held = readPreparedNativeSave(await request(stores[MOTION_NATIVE_SAVE_STORE]!.get(native.record.id)));
				if (JSON.stringify(held) !== JSON.stringify(native.record) || !native.recovering && held.leaseToken !== lease.token || pointer?.nativeSaveId !== held.id) throw new MotionProjectConflictError();
			}
			for (const stage of staging) await stage.publish(stores);
			for (const asset of snapshot.project.assets) await this.#assets.assertAvailable(stores, asset);
			await this.#leases.assert(stores, lease);
			if (native?.type === 'prepare') {
				if (native.record.leaseToken !== lease.token) throw new MotionProjectConflictError();
				const priorNative: unknown = await request(stores[MOTION_NATIVE_SAVE_STORE]!.get(native.record.id));
				if (priorNative !== undefined && JSON.stringify(readPreparedNativeSave(priorNative)) !== JSON.stringify(native.record)) throw new MotionProjectConflictError();
				await request(stores.projects.put({ ...(pointer ?? { id: snapshot.projectId, savedDigest: null, savedTitle: null, savedRevision: null, recovery: snapshot.project }), nativeSaveId: native.record.id } satisfies ProjectPointer));
				await request(stores[MOTION_NATIVE_SAVE_STORE]!.put(native.record)); return false;
			}
			if (imported && imported !== true) {
				if (!pointer || snapshot.revision <= Math.max(pointer.savedRevision ?? -1, pointer.recovery?.revision ?? -1)) throw new MotionProjectConflictError('The replacement draft must advance the local revision.');
				if (pointer.recovery) {
					const retained = createMotionscaperRevision(pointer.recovery);
					await request(stores.revisions.put({ key: revisionKey(retained.projectId, retained.digest), projectId: retained.projectId, snapshot: retained } satisfies StoredRevision));
				}
				await request(stores.projects.put({ ...pointer, recovery: snapshot.project } satisfies ProjectPointer));
				return true;
			}
			await request(stores.revisions.put({ key: revisionKey(snapshot.projectId, snapshot.digest),
				projectId: snapshot.projectId, snapshot } satisfies StoredRevision));
			await request(stores.projects.put({ id: snapshot.projectId, savedDigest: snapshot.digest,
				savedTitle: snapshot.project.title, savedRevision: snapshot.revision, recovery: null } satisfies ProjectPointer));
			if (native) await request(stores[MOTION_NATIVE_SAVE_STORE]!.delete(native.record.id));
			return true;
		});
	}


	async loadNativeSave(projectId: string): Promise<MotionPreparedNativeSave | null> {
		motionId(projectId); const database = await this.#database();
		return transact(database, ['projects', MOTION_NATIVE_SAVE_STORE], 'readonly', async stores => {
			const value: unknown = await request(stores.projects.get(projectId));
			const pointer = value === undefined ? null : readPointer(value, projectId);
			if (!pointer?.nativeSaveId) return null;
			const record = readPreparedNativeSave(await request(stores[MOTION_NATIVE_SAVE_STORE]!.get(pointer.nativeSaveId)));
			if (record.projectId !== projectId || record.expectedDigest !== pointer.savedDigest) throw new MotionProjectConflictError('Prepared native Save lost its reserved saved head.');
			return record;
		});
	}
	async loadNativeSaveTransaction(id: string): Promise<MotionPreparedNativeSave | null> {
		motionId(id); const database = await this.#database();
		return transact(database, ['projects', MOTION_NATIVE_SAVE_STORE], 'readonly', async stores => {
			const value: unknown = await request(stores[MOTION_NATIVE_SAVE_STORE]!.get(id));
			if (value === undefined) return null;
			const record = readPreparedNativeSave(value);
			const raw: unknown = await request(stores.projects.get(record.projectId));
			const pointer = raw === undefined ? null : readPointer(raw, record.projectId);
			if (record.id !== id || pointer?.nativeSaveId !== id || record.expectedDigest !== pointer.savedDigest) throw new MotionProjectConflictError('Prepared native Save lost its reserved saved head.');
			return record;
		});
	}
	async prepareNativeSave(value: unknown, expectedDigest: string | null, lease: MotionProjectWriteLease,
		receipt: MotionSaveFileReceipt): Promise<MotionPreparedNativeSave> {
		assertNativeSaveReceipt(receipt, 'prepared');
		const snapshot = createMotionscaperRevision(value);
		const record = readPreparedNativeSave({ id: receipt.transactionId, projectId: snapshot.projectId, expectedDigest,
			snapshot, leaseToken: lease.token, archiveSha256: receipt.sha256, archiveByteLength: receipt.byteLength });
		await this.#publish(snapshot, expectedDigest, [], lease, undefined, { type: 'prepare', record }); return record;
	}
	async finalizeNativeSave(record: MotionPreparedNativeSave, receipt: MotionSaveFileReceipt | MotionRecoveredPublication,
		lease: MotionProjectWriteLease, recovering = false): Promise<MotionscaperRevision> {
		assertNativeSaveReceipt(receipt, 'published', record);
		const changed = await this.#publish(record.snapshot, record.expectedDigest, [], lease, undefined, { type: 'publish', record, recovering });
		if (changed) this.#notify(record.snapshot); return record.snapshot;
	}
	async cancelNativeSave(record: MotionPreparedNativeSave, receipt: MotionSaveFileReceipt | MotionRecoveredPublication,
		lease: MotionProjectWriteLease, recovering = false): Promise<void> {
		assertNativeSaveReceipt(receipt, 'rolled-back', record); const database = await this.#database();
		await transact(database, ['projects', MOTION_NATIVE_SAVE_STORE, MOTION_PROJECT_LEASE_STORE], 'readwrite', async stores => {
			await this.#leases.assert(stores, lease, true);
			if (lease.projectId !== record.projectId || !recovering && lease.token !== record.leaseToken) throw new MotionProjectConflictError();
			const value: unknown = await request(stores.projects.get(record.projectId));
			const pointer = value === undefined ? null : readPointer(value, record.projectId);
			if (!pointer?.nativeSaveId) return;
			const held = readPreparedNativeSave(await request(stores[MOTION_NATIVE_SAVE_STORE]!.get(pointer.nativeSaveId)));
			if (pointer.nativeSaveId !== record.id || pointer.savedDigest !== record.expectedDigest || JSON.stringify(held) !== JSON.stringify(record)) throw new MotionProjectConflictError();
			const { nativeSaveId: _prepared, ...prior } = pointer;
			await request(stores.projects.put(prior)); await request(stores[MOTION_NATIVE_SAVE_STORE]!.delete(record.id));
		});
	}

	#notify(snapshot: MotionscaperRevision): void {
		for (const listener of this.#listeners) {
			// A listener cannot turn an already durable save into a failed publication.
			try { listener(snapshot); } catch { /* Subscriber diagnostics belong to its owning workflow. */ }
		}
	}

	async saveRecovery(value: unknown, expectedDigest: string | null, authority?: MotionProjectWriteLease): Promise<void> {
		const project = normalizeMotionscaperProject(value);
		if (expectedDigest !== null) motionDigest(expectedDigest);
		const database = await this.#database();
		const lease = authority ?? await this.#leases.defaultLease(project.id);
		if (lease.projectId !== project.id) throw new MotionProjectConflictError();
		await transact(database, ['projects', 'assets', MOTION_PROJECT_LEASE_STORE], 'readwrite', async (stores) => {
			await this.#leases.assert(stores, lease, true);
			const stored: unknown = await request(stores.projects.get(project.id));
			const pointer = stored === undefined ? null : readPointer(stored, project.id);
			if (pointer?.nativeSaveId) throw new MotionProjectConflictError('Resolve the prepared native Save before editing this project.');
			if ((pointer?.savedDigest ?? null) !== expectedDigest) throw new MotionProjectConflictError();
			for (const asset of project.assets) await this.#assets.assertAvailable(stores, asset);
			await this.#leases.assert(stores, lease);
			await request(stores.projects.put({ id: project.id, savedDigest: expectedDigest,
				savedTitle: pointer?.savedTitle ?? null, savedRevision: pointer?.savedRevision ?? null,
				recovery: project } satisfies ProjectPointer));
		});
	}

	async load(id: string): Promise<MotionscaperRevision | null> {
		motionId(id);
		const database = await this.#database();
		return transact(database, ['projects', 'revisions'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.projects.get(id));
			if (value === undefined) return null;
			const pointer = readPointer(value, id);
			if (!pointer.savedDigest) return null;
			const snapshot = readRevision(await request(stores.revisions.get(revisionKey(id, pointer.savedDigest))), id, pointer.savedDigest);
			assertSavedPointer(pointer, snapshot);
			return snapshot;
		});
	}

	/** One transactional view of the saved head and recovery used by an explicit archive review. */
	async inspectImport(id: string): Promise<MotionProjectImportState | null> {
		motionId(id); const database = await this.#database();
		return transact(database, ['projects', 'revisions'], 'readonly', async stores => {
			const value: unknown = await request(stores.projects.get(id)); if (value === undefined) return null;
			const pointer = readPointer(value, id);
			const saved = pointer.savedDigest ? readRevision(await request(stores.revisions.get(revisionKey(id, pointer.savedDigest))), id, pointer.savedDigest) : null;
			if (saved) assertSavedPointer(pointer, saved);
			return Object.freeze({ saved, recovery: pointer.recovery, savedDigest: pointer.savedDigest,
				recoveryDigest: pointer.recovery ? createMotionscaperRevision(pointer.recovery).digest : null });
		});
	}

	async loadRevision(id: string, digest: string): Promise<MotionscaperRevision | null> {
		motionId(id); motionDigest(digest);
		const database = await this.#database();
		return transact(database, ['revisions'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.revisions.get(revisionKey(id, digest)));
			return value === undefined ? null : readRevision(value, id, digest);
		});
	}

	async loadRecovery(id: string): Promise<MotionscaperProject | null> {
		motionId(id);
		const database = await this.#database();
		return transact(database, ['projects'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.projects.get(id));
			return value === undefined ? null : readPointer(value, id).recovery;
		});
	}

	async list(): Promise<readonly MotionProjectSummary[]> {
		const database = await this.#database();
		return transact(database, ['projects'], 'readonly', (stores) => new Promise<MotionProjectSummary[]>((resolve, reject) => {
			const summaries: MotionProjectSummary[] = [];
			const cursorRequest = stores.projects.openCursor();
			cursorRequest.onerror = () => reject(cursorRequest.error);
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (!cursor) { resolve(summaries); return; }
				try {
					const pointer = readPointer(cursor.value, motionId(cursor.primaryKey));
					summaries.push(Object.freeze({ id: pointer.id,
						title: pointer.savedTitle ?? pointer.recovery?.title ?? pointer.id,
						revision: pointer.savedRevision ?? pointer.recovery?.revision ?? 0,
						savedDigest: pointer.savedDigest, hasRecovery: pointer.recovery !== null }));
					cursor.continue();
				} catch (error) { reject(error); }
			};
		}));
	}

	putAsset(asset: unknown, body: Blob, signal?: AbortSignal): Promise<void> { return this.#assets.put(asset, body, signal); }
	loadAsset(asset: unknown): Promise<Blob | null> { return this.#assets.load(asset); }
	readAsset(asset: unknown): Promise<MotionAssetBody | null> { return this.#assets.read(asset); }

	async beginImport(projectInput: unknown, lease?: MotionProjectWriteLease, publication?: MotionProjectImportPublication): Promise<MotionArchiveImportTransaction> {
		const project = normalizeMotionscaperProject(projectInput);
		const stages = new Map<string, MotionAssetStaging>();
		let settled = false;
		const find = async (asset: MotionAsset): Promise<MotionAssetStaging> => {
			if (settled) throw new Error('Motion import transaction is closed.');
			const owned = project.assets.find((entry) => entry.id === asset.id);
			if (!owned || JSON.stringify(asset) !== JSON.stringify(owned)) throw new Error('Motion import asset is outside its project closure.');
			let stage = stages.get(asset.id);
			if (!stage) { stage = await this.#assets.stage(asset); stages.set(asset.id, stage); }
			return stage;
		};
		return {
			writeAssetChunk: async (asset, bytes) => { await (await find(asset)).write(bytes); },
			finishAsset: async (asset) => { await (await find(asset)).finish(); },
			commit: async (value) => {
				if (settled) throw new Error('Motion import transaction is closed.');
				const snapshot = createMotionscaperRevision(value);
				if (snapshot.digest !== createMotionscaperRevision(project).digest) throw new Error('Motion project changed during import.');
				await this.#publish(snapshot, publication?.expected.savedDigest ?? null, [...stages.values()], lease, publication ?? true);
				settled = true;
				if (!publication) this.#notify(snapshot);
			},
			rollback: async () => {
				if (settled) return;
				for (const stage of stages.values()) await stage.rollback();
				settled = true;
			},
		};
	}
}

function revisionKey(id: string, digest: string): string { return `${id}:${digest}`; }
function readRevision(value: unknown, id: string, digest: string): MotionscaperRevision {
	const record = motionRecord(value, ['key', 'projectId', 'snapshot'], 'stored motion revision');
	const snapshot = verifyMotionscaperRevision(record.snapshot);
	if (record.key !== revisionKey(id, digest) || record.projectId !== id || snapshot.projectId !== id || snapshot.digest !== digest) {
		throw new Error('Stored motion revision identity does not match its requested project.');
	}
	return snapshot;
}
function readPointer(value: unknown, id: string): ProjectPointer {
	const record = motionRecord(value, ['id', 'savedDigest', 'savedTitle', 'savedRevision', 'recovery', 'nativeSaveId'], 'stored motion project pointer', ['id', 'savedDigest', 'savedTitle', 'savedRevision', 'recovery']);
	const recovery = record.recovery === null ? null : normalizeMotionscaperProject(record.recovery);
	if (record.id !== id || (recovery && recovery.id !== id)) {
		throw new Error('Stored motion recovery or pointer identity does not match its project.');
	}
	if ((record.savedDigest === null) !== (record.savedTitle === null) || (record.savedDigest === null) !== (record.savedRevision === null)) {
		throw new Error('Stored motion project pointer has inconsistent saved metadata.');
	}
	return { id: motionId(id), savedDigest: record.savedDigest === null ? null : motionDigest(record.savedDigest),
		savedTitle: record.savedTitle === null ? null : motionString(record.savedTitle, 'saved title'),
		savedRevision: record.savedRevision === null ? null : motionInteger(record.savedRevision, 'saved revision'), recovery, ...(record.nativeSaveId === undefined ? {} : { nativeSaveId: motionId(record.nativeSaveId) }) };
}
function assertSavedPointer(pointer: ProjectPointer, snapshot: MotionscaperRevision): void {
	if (pointer.savedTitle !== snapshot.project.title || pointer.savedRevision !== snapshot.revision) {
		throw new Error('Stored motion project pointer disagrees with its saved revision.');
	}
}
