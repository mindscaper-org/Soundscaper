/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoRasterPersistedBatchCurrentV1 } from '../../src/lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import { PhotoRasterExportBatchQueueCurrentV1, type PhotoRasterExportBatchRuntimeCurrentV1 } from '../../src/lightscaper/controller/photo-raster-export-batch-queue-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { encodePhotoPngCurrentV1 } from '../../src/lightscaper/controller/photo-png-export-encoder-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../../src/common/editor/imaging/image-develop-state-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../../src/common/editor/browser-file-save-service.ts';
import { PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { readStoredPhotoCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-records-current-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as CATALOG } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 as MEDIA } from '../../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoRasterExportJournalCurrentV1, type PhotoRasterExportJournalCurrentV1 } from '../../src/lightscaper/storage/photo-raster-export-journal-current-v1.ts';
import { photoRasterExportJournalKeyV1 } from '../../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';

type Session = Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>;
interface Scope { readonly session: Session; readonly owner: PhotoRasterPersistedBatchCurrentV1; readonly stop: AbortController;
	queue: PhotoRasterExportBatchQueueCurrentV1 | null; work: Promise<unknown> | null; pending: boolean; closeCalls: number; destinationCalls: number; retirement?: Promise<void> }
export interface RasterCrashSnapshot {
	readonly stable: Readonly<{ catalogJson: string; assetsJson: string; custodyJson: string; stagingJson: string; paths: readonly string[] }>;
	readonly photos: readonly Readonly<{ photo: PhotoDocumentCurrentV1; bytes: readonly number[]; path: string; contentToken: string }>[];
	readonly journal: Readonly<PhotoRasterExportJournalCurrentV1> | null;
	readonly journalRecordJson: string | null;
}
export interface RasterCrashPrepared { readonly ids: readonly string[]; readonly before: Readonly<RasterCrashSnapshot> }
export interface RasterCrashRecovery { readonly dispositions: readonly string[]; readonly unreviewedRefused: boolean; readonly snapshot: Readonly<RasterCrashSnapshot> }
interface SinkGlobal { __rasterCrashPngSink?: (phase: string, name: string, bytes: readonly number[]) => Promise<BrowserSavedFile>;
	__assertNativeOpfsWorkerExecution?: () => Promise<void> }
let live: Scope | null = null;
const TIME = '2026-10-27T00:00:00.000Z', TEMPLATE = '{index:2}-{name}';

/** Test-only destination transport. Catalog mutation, Original decoding,
 * Develop, PNG and every journal transition retain their production owners. */
export async function prepareRasterExportCrashCurrent(originals: readonly (readonly number[])[]): Promise<RasterCrashPrepared> {
	check(live === null && originals.length === 2, 'Crash preparation requires one fresh two-photo scope.');
	check(!(await indexedDB.databases()).some(row => row.name === CATALOG || row.name === MEDIA.databaseName), 'Crash preparation cannot adopt an existing profile.');
	const session = await createPhotoLibrarySessionCurrentV1({ name: 'Raster export process crash', indexedDB, locks: navigator.locks });
	let scope: Scope | undefined;
	try {
		const receipts = await session.importFiles(originals.map((values, index) => {
			check(Array.isArray(values) && values.length > 0 && values.length <= 65_536 && values.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'Original fixture exceeds its tiny byte bound.');
			return new File([Uint8Array.from(values)], index === 0 ? 'Crash first.png' : 'Crash second.png', { type: 'image/png', lastModified: 0 });
		}));
		const ids = receipts.map(receipt => { check(receipt.status === 'imported' && typeof receipt.photoId === 'string', 'Actual import ACK missing.'); return receipt.photoId; });
		check(ids.length === 2 && new Set(ids).size === 2, 'Two distinct imported photos are required.');
		const develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV1(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] },
			effects: [{ id: 'crash-exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }] });
		for (const photoId of ids) {
			const saved = await session.develop.read({ schemaVersion: 3, photoId });
			await session.develop.apply({ schemaVersion: 3, photoId, expectedRevision: saved.revision,
				command: { type: 'record-develop', versionId: saved.versionId, develop, label: 'Crash qualification exposure', createdAt: TIME } });
		}
		await companion(); const before = await readRasterExportCrashSnapshotCurrent(ids);
		check(before.journal === null && before.photos.every(row => row.photo.schemaVersion === 3), 'Fresh Current history must precede journal creation.');
		scope = await prepareScope(session, ids.map((photoId, index) => ({ photoId, fileName: index === 0 ? 'Crash first.png' : 'Crash second.png' })));
		const selected = scope.owner.prepared; check(selected?.members.length === 2, 'Actual saved selection must contain both photos.');
		const current = scope, queue = new PhotoRasterExportBatchQueueCurrentV1(runtime(current, 'initial', [])); current.queue = queue; live = current;
		current.work = queue.start({ schemaVersion: 1, batchId: 'raster-process-crash', format: 'png', filenameTemplate: TEMPLATE,
			members: selected.members }).then(value => { current.pending = false; return value; }, (error: unknown) => { current.pending = false; return { error }; });
		return { ids, before };
	} catch (error) {
		const [cleanup] = await Promise.allSettled([scope ? retire(scope) : session.close()]);
		if (cleanup?.status === 'rejected') throw new AggregateError([error, cleanup.reason], 'Crash preparation and retirement failed.', { cause: error });
		throw error;
	}
}

export function readRasterExportCrashLiveCurrent() {
	check(live !== null, 'The crash owner must remain live.');
	return { pending: live.pending, signalAborted: live.stop.signal.aborted, closeCalls: live.closeCalls, destinationCalls: live.destinationCalls };
}

/** Existing native databases and read-only transactions only: this observes the
 * durable prefix before any reopened Session can reconcile or acquire work. */
export async function readRasterExportCrashSnapshotCurrent(ids: readonly string[]): Promise<RasterCrashSnapshot> {
	check(ids.length === 2 && new Set(ids).size === 2 && ids.every(id => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(id)), 'Snapshot requires two bounded photo identities.');
	const catalog = await rows(CATALOG, PHOTO_CATALOG_STORES), media = await rows(MEDIA.databaseName, ['mediaAssets', 'catalogOriginalRoots', 'mediaAssetStaging', 'settings']);
	const documents = catalog.photos!.map(value => readStoredPhotoCurrentV1(value)); check(documents.length === 2, 'Complete native Photo inventory differs.');
	const assets = media.mediaAssets as StorageRecord[]; check(assets.length === 2, 'Complete native Original inventory differs.');
	const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(MEDIA.opfsDirectoryName);
	const photos = [];
	for (const id of ids) {
		const photo = documents.find(photo => photo.id === id); check(photo !== undefined, 'Requested native Photo missing.');
		const asset = assets.find(asset => asset.sourceId === photo.original.storageKey);
		check(asset !== undefined && asset.storage === 'opfs' && typeof asset.path === 'string' && typeof asset.mediaContentToken === 'string', 'Actual native Original/path/token is required.');
		const file = await (await directory.getFileHandle(asset.path)).getFile(); check(file.size === photo.original.byteLength && file.size <= 65_536, 'Original body differs from its tiny native binding.');
		const bytes = new Uint8Array(await file.arrayBuffer());
		try { check(await digest(bytes) === photo.original.contentSha256 && asset.sha256 === photo.original.contentSha256 && asset.size === bytes.length, 'Actual Original bytes disagree with Photo/native hashes.');
			photos.push({ photo, bytes: [...bytes], path: asset.path, contentToken: asset.mediaContentToken }); }
		finally { bytes.fill(0); }
	}
	const paths: string[] = [];
	for await (const name of (directory as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }).keys()) { paths.push(name); check(paths.length <= 2, 'Unexpected physical Original file.'); }
	paths.sort(); check(JSON.stringify(paths) === JSON.stringify(photos.map(photo => photo.path).sort()), 'Complete physical Original inventory differs.');
	const catalogId = photos[0]!.photo.catalogId; check(photos.every(row => row.photo.catalogId === catalogId), 'Photo catalog bindings differ.');
	const record = media.settings!.find(value => field(value, 'key') === photoRasterExportJournalKeyV1(catalogId));
	const journal = record === undefined ? null : normalizePhotoRasterExportJournalCurrentV1(field(record, 'value'));
	const stable = { catalogJson: JSON.stringify(catalog), assetsJson: JSON.stringify(assets), custodyJson: JSON.stringify(media.catalogOriginalRoots),
		stagingJson: JSON.stringify(media.mediaAssetStaging), paths };
	check(new TextEncoder().encode(JSON.stringify({ stable, photos, journal })).length <= 262_144, 'Native crash snapshot exceeds its scalar bound.');
	return { stable, photos, journal, journalRecordJson: record === undefined ? null : JSON.stringify(record) };
}

export async function inspectRasterExportRecoveryCurrent(ids: readonly string[]): Promise<RasterCrashRecovery> {
	const observed = await withRecoveryScope('Raster crash inspection', async scope => {
		const owner = scope.owner, journal = owner.journal; check(journal !== null, 'Recovered journal missing.');
		const dispositions = owner.recovery.map(entry => entry.disposition), unfinished = owner.recovery.filter(entry => entry.disposition === 'needs-review');
		let unreviewedRefused = unfinished.length === 0;
		if (unfinished.length) {
			check(unfinished.length === 1, 'Only one lost acknowledgment is expected.');
			const queue = new PhotoRasterExportBatchQueueCurrentV1(runtime(scope, 'reviewed', [])); scope.queue = queue;
			const outcome = await queue.startRecovery(journal, [unfinished[0]!.member.jobId]).then(() => false, () => true);
			unreviewedRefused = outcome; check(outcome && scope.destinationCalls === 0, 'Unreviewed uncertainty acquired a destination.');
		}
		return { dispositions, unreviewedRefused };
	});
	return { ...observed, snapshot: await readRasterExportCrashSnapshotCurrent(ids) };
}

/** The caller supplies explicit consent only for the genuine unfinished job.
 * Production recovery owns selection, review enforcement and all native CAS. */
export async function recoverRasterExportCurrent(ids: readonly string[], reviewed: readonly string[]): Promise<RasterCrashSnapshot> {
	await withRecoveryScope('Reviewed raster crash recovery', async scope => {
		const journal = scope.owner.journal;
		check(journal !== null && reviewed.length === 1 && journal.members[0]?.state === 'committed' && journal.members[1]?.jobId === reviewed[0], 'Explicit recovery must select only the lost-ACK member.');
		const queue = new PhotoRasterExportBatchQueueCurrentV1(runtime(scope, 'reviewed', reviewed)); scope.queue = queue;
		const receipt = await queue.startRecovery(journal, reviewed);
		check(receipt.phase === 'settled' && receipt.members.length === 1 && receipt.members[0]?.state === 'completed' && scope.destinationCalls === 1, 'Recovery must deliver only one reviewed member.');
		await companion();
	});
	return await readRasterExportCrashSnapshotCurrent(ids);
}

export async function retireRasterExportCrashCurrent(): Promise<void> {
	const current = live; live = null; if (current) await retire(current);
}

async function withRecoveryScope<Result>(name: string, run: (scope: Scope) => Promise<Result>): Promise<Result> {
	const session = await createPhotoLibrarySessionCurrentV1({ name, indexedDB, locks: navigator.locks });
	let scope: Scope | undefined;
	const outcome = await Promise.resolve().then(async () => { scope = await prepareScope(session, []); return run(scope); })
		.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	let cleanup: Readonly<{ error: unknown }> | undefined;
	try { if (scope) await retire(scope); else await session.close(); } catch (error) { cleanup = { error }; }
	if (!outcome.ok) {
		if (cleanup) throw new AggregateError([outcome.error, cleanup.error], 'Recovery and owner retirement failed.', { cause: outcome.error });
		throw outcome.error;
	}
	if (cleanup) throw cleanup.error; return outcome.value;
}

async function prepareScope(session: Session, selection: readonly Readonly<{ photoId: string; fileName: string }>[]): Promise<Scope> {
	const stop = new AbortController(), execute: ExecutePhotoDevelopCurrentV1 = async (run, caller) => {
		await run({ signal: caller ?? stop.signal, acquire: async () => session.develop, isCurrent: () => !stop.signal.aborted,
			refresh: () => session.readPage() }); return 'completed';
	};
	const read = session.readExportSidecarCurrent, journal = session.exportJournalCurrent; check(read !== undefined && journal !== undefined, 'Current saved facts/journal capability missing.');
	const owner = await PhotoRasterPersistedBatchCurrentV1.prepare({ selection, execute, signal: stop.signal,
		readSidecar: (...args) => Reflect.apply(read, session, args), openJournal: (...args) => Reflect.apply(journal.open, journal, args) });
	return { session, owner, stop, queue: null, work: null, pending: true, closeCalls: 0, destinationCalls: 0 };
}

function runtime(scope: Scope, phase: 'initial' | 'reviewed', reviewed: readonly string[]): PhotoRasterExportBatchRuntimeCurrentV1 {
	const { session, owner } = scope, original = session.develop.original; check(original !== undefined, 'Actual canonical Original owner missing.');
	const renderer = createPhotoDevelopRenderRuntimeCurrentV1({ source: session.cubeLuts.source, maskSource: session.maskRasterSource });
	const saveRuntime = {
		prepareSave(input: BrowserFileSaveRequest): PreparedBrowserSave {
			check(input.useFileSystemAccess === false && input.target !== null && input.target !== undefined && typeof input.fileName === 'string', 'Persisted batches must retain explicit download targets.');
			return { mode: 'blob', target: input.target, fileName: input.fileName };
		},
		async saveFile(input: BrowserFileSaveRequest): Promise<BrowserSavedFile> {
			check(input.blob instanceof Blob && input.blob.type === 'image/png' && input.blob.size > 0 && input.blob.size <= 65_536 && typeof input.fileName === 'string', 'Actual tiny PNG delivery is required.');
			const sink = (globalThis as SinkGlobal).__rasterCrashPngSink; check(typeof sink === 'function', 'Owned filesystem sink missing.');
			scope.destinationCalls++; return await sink(phase, input.fileName, [...new Uint8Array(await input.blob.arrayBuffer())]);
		},
	};
	return { fileTypeDescription: 'PNG',
		execute: async (run, caller) => { await run({ signal: caller ?? scope.stop.signal, acquire: async () => session.develop,
			isCurrent: () => !scope.stop.signal.aborted, refresh: () => session.readPage() }); return 'completed'; },
		withOriginalFrame: (...args) => Reflect.apply(original.withFrame, original, args),
		loadRenderer: async () => renderer,
		encode: async (format, frame, options) => { check(format === 'png', 'Only lossless PNG belongs to this fixture.'); return encodePhotoPngCurrentV1(frame, options); },
		prepareDestinations: plan => phase === 'initial' ? owner.prepareFreshDestinations(plan, saveRuntime, TEMPLATE)
			: owner.prepareRecoveryDestinations(plan, saveRuntime, reviewed) };
}

function retire(scope: Scope): Promise<void> {
	if (scope.retirement) return scope.retirement;
	scope.stop.abort();
	scope.retirement = (async () => {
		const settled = await Promise.allSettled([scope.queue?.cancelAndJoin(), scope.work]);
		const failures = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		try { await scope.owner.closeAndJoin(); } catch (error) { failures.push(error); }
		if (scope.destinationCalls) try { await companion(); } catch (error) { failures.push(error); }
		scope.closeCalls++; try { await scope.session.close(); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Raster crash owner retirement failed.');
	})();
	return scope.retirement;
}
async function rows(name: string, stores: readonly string[]): Promise<Record<string, unknown[]>> {
	const inventory = await indexedDB.databases(), existing = inventory.find(row => row.name === name); check(existing?.version !== undefined, 'Existing native database required.');
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		let refused = false;
		const opening = indexedDB.open(name, existing.version);
		opening.onupgradeneeded = () => { refused = true; opening.transaction?.abort(); reject(new Error('Readonly snapshot cannot upgrade a database.')); };
		opening.onerror = () => { refused = true; reject(opening.error); }; opening.onblocked = () => { refused = true; reject(new Error('Readonly snapshot database blocked.')); };
		opening.onsuccess = () => { if (refused) opening.result.close(); else resolve(opening.result); };
	});
	try { return await transact(database, stores, 'readonly', async objects => {
		const values = await Promise.all(stores.map(async key => { const store = objects[key]; check(store !== undefined, 'Native snapshot store missing.');
			const records: unknown[] = await request(store.getAll(undefined, 17)); check(records.length <= 16, 'Native snapshot exceeds complete tiny inventory.'); return records; }));
		return Object.fromEntries(stores.map((key, index) => [key, values[index]!]));
	}); } finally { database.close(); }
}
function field(value: unknown, key: string): unknown { check(value !== null && typeof value === 'object', 'Expected native stored record.'); return (value as Record<string, unknown>)[key]; }
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function companion(): Promise<void> { const check = (globalThis as SinkGlobal).__assertNativeOpfsWorkerExecution; if (typeof check !== 'function') throw new Error('Native OPFS worker companion missing.'); await check(); }
