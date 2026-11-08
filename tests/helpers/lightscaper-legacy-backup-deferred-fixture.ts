/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { PhotoLibrarySessionV1 } from '../../src/lightscaper/controller/photo-library-session.ts';
import { exportPhotoLibraryBackupV1 } from '../../src/lightscaper/controller/photo-library-backup-v1.ts';
import { exportPhotoLibraryBackupV3 } from '../../src/lightscaper/controller/photo-library-backup-v3.ts';
import type { PhotoLibraryBackupOptionsV1 } from '../../src/common/editor/photo-library-backup-port-v1.ts';
import { importPhotoCatalogArchiveV4 } from '../../src/lightscaper/archive/catalog-archive-import-v4.ts';
import { smartCollectionAuditFixtureV1, AUDIT_DATABASE } from './lightscaper-smart-collection-audit-fixture.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { developPresetArchiveRow } from './lightscaper-develop-preset-archive-fixture.ts';
import { deferred } from './async-test-control.ts';

export const LEGACY_BACKUP_VARIANTS = ['v1', 'v1-stacks', 'v3', 'session-v4'] as const;
export type LegacyBackupVariant = typeof LEGACY_BACKUP_VARIANTS[number];
export const LEGACY_BACKUP_TEST_OPTIONS = { timeout: 15_000 };

async function openFixture(context: TestContext) {
	const base = await smartCollectionAuditFixtureV1(1), stop = new AbortController();
	const signal = AbortSignal.any([context.signal, stop.signal]);
	const gates = new Set<() => void>(), pending = new Set<Promise<unknown>>();
	const release = (): void => { for (const run of gates) run(); };
	signal.addEventListener('abort', release);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const owners: (() => Promise<void>)[] = [];
	try {
		const media = new PhotoMediaStoreV1({ indexedDB: base.factory, databaseName: `lightscaper-legacy-backup-${crypto.randomUUID()}`, preferOpfs: false, locks: null });
		owners.push(() => media.close());
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB: base.factory, databaseName: AUDIT_DATABASE, verifyOriginal: media.verifyOriginal });
		owners.push(() => catalog.close());
		timer = setTimeout(() => { stop.abort(new Error('Legacy deferred backup active deadline')); }, 13_000);
		const sources = [photoArchiveFixture(1), photoArchiveFixture(2, new Uint8Array([4, 5, 6]))]
			.map(source => ({ original: source.original, photo: normalizePhotoDocumentV1({ ...source.photo, catalogId: base.root.id }) }));
		for (const source of sources) {
			await media.mediaRepository.writeAsset(source.photo.original.storageKey, source.original);
			await media.mediaRepository.catalogOriginals.retain(base.root.id, [{ photoId: source.photo.id, sourceId: source.photo.original.id,
				assetId: source.photo.original.storageKey, sha256: source.photo.original.contentSha256, size: source.photo.original.byteLength }]);
		}
		let root = await catalog.publishPhotos(base.root.id, base.root.revision, sources.map(source => source.photo));
		const stack = normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'stack', revision: 0,
			photoIds: sources.map(source => source.photo.id), coverPhotoId: sources[0]!.photo.id });
		await catalog.saveStack(stack, null, { expectedCatalogRevision: root.revision, expectedStateRevision: 0 });
		const current = await catalog.loadCatalog(root.id); assert.ok(current); root = current;
		const preset = normalizePhotoDevelopPresetRowV1({ ...developPresetArchiveRow(7, 1), catalogId: root.id }, root.id);
		const presetKey = photoDevelopPresetsKeyV1(root.id); await media.settingsRepository.put(presetKey, preset);
		const calls = { originals: 0, snapshots: 0 };
		const backup = { readSnapshot: (...args: Parameters<typeof catalog.readSnapshot>) => { calls.snapshots++; return catalog.readSnapshot(...args); },
			captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			async loadOriginal(original: typeof sources[number]['photo']['original'], admitted?: AbortSignal) {
				calls.originals++; await media.verifyOriginal(original, admitted);
				return media.mediaRepository.loadAsset(original.storageKey, { expectedSize: original.byteLength, signal: admitted });
			} };
		const ports = { catalog: { readSnapshot: backup.readSnapshot, readSummaryPage: catalog.readSummaryPage.bind(catalog),
			loadPhoto: catalog.loadPhoto.bind(catalog), captureSmartCollectionArchiveV1: backup.captureSmartCollectionArchiveV1 },
			stacks: catalog, loadOriginal: backup.loadOriginal, developPresetSettings: media.settingsRepository };
		const session = new PhotoLibrarySessionV1({ catalog, stacks: catalog, smartCollections: catalog, backup,
			developPresetSettings: media.settingsRepository, journal: media.settingsRepository,
			media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
			initialize: async () => root, exclusive: async (_catalogId, run, admitted) => run(admitted),
			closeResources: async () => {
				const settled = await Promise.allSettled(owners.map(close => Promise.resolve().then(close)));
				const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
				if (errors.length) throw new AggregateError(errors, 'Legacy backup repository cleanup failed.');
			} });
		return { root, sources, stack, preset, presetKey, catalog, media, signal, calls,
			gate() { const value = deferred<void>(); gates.add(() => { value.resolve(); }); return value; },
			run(variant: LegacyBackupVariant, options: PhotoLibraryBackupOptionsV1) {
				const work = variant === 'session-v4' ? session.backupCatalog(options)
					: variant === 'v3' ? exportPhotoLibraryBackupV3(root.id, ports, options)
						: exportPhotoLibraryBackupV1(root.id, variant === 'v1-stacks' ? ports : { catalog: ports.catalog, loadOriginal: ports.loadOriginal }, options);
				pending.add(work); void work.catch(() => undefined); return work;
			},
			async roundTrip(blob: Blob, variant: LegacyBackupVariant) {
				let photos = 0, stacks = 0, saved = 0, presets = 0, published = 0;
				const expectedSaved = await catalog.loadSmartCollection(root.id, 'saved-00000'); assert.ok(expectedSaved);
				assert.deepEqual(await importPhotoCatalogArchiveV4(blob, async () => ({
					async writePhoto(photo, chunks) {
						const source = sources[photos++]; assert.ok(source); assert.deepEqual(photo, source.photo);
						const parts: Uint8Array<ArrayBuffer>[] = []; for await (const chunk of chunks) parts.push(new Uint8Array(chunk));
						assert.deepEqual(new Uint8Array(await new Blob(parts).arrayBuffer()), new Uint8Array(await source.original.arrayBuffer()));
					},
					async writeStack(value) { stacks++; assert.deepEqual(value, stack); },
					async writeSavedCollection(value) { saved++; assert.deepEqual(value, expectedSaved); },
					async writeDevelopPresets(value) { presets++; assert.deepEqual(value, preset); },
					async publish() { published++; }, async rollback() { assert.fail('Genuine backup ZIP must publish'); },
				})), root);
				assert.equal(photos, 2); assert.equal(stacks, variant === 'v1' ? 0 : 1);
				assert.equal(saved, variant === 'v3' || variant === 'session-v4' ? 1 : 0);
				assert.equal(presets, variant === 'session-v4' ? 1 : 0); assert.equal(published, 1);
			},
			async close() {
				release(); stop.abort(); await Promise.allSettled(pending);
				try { await session.close(); } finally { base.close(); clearTimeout(timer); signal.removeEventListener('abort', release); }
			} };
	} catch (error) {
		release(); stop.abort(); const settled = await Promise.allSettled(owners.map(close => Promise.resolve().then(close)));
		base.close(); clearTimeout(timer); signal.removeEventListener('abort', release);
		const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (errors.length) throw new AggregateError([error, ...errors], 'Legacy backup setup and cleanup failed.', { cause: error });
		throw error;
	}
}
export type LegacyBackupFixture = Awaited<ReturnType<typeof openFixture>>;
export async function legacyBackupFixture(context: TestContext, run: (fixture: LegacyBackupFixture) => Promise<void>): Promise<void> {
	const f = await openFixture(context); let failed = false, primary: unknown, cleanupFailed = false, cleanup: unknown;
	try { await run(f); } catch (error) { failed = true; primary = error; }
	try { await f.close(); } catch (error) { cleanupFailed = true; cleanup = error; }
	if (cleanupFailed) throw new AggregateError(failed ? [primary, cleanup] : [cleanup], 'Legacy backup fixture cleanup failed.', { cause: failed ? primary : cleanup });
	if (failed) throw primary;
}
export function legacyBackupDestination(onClose?: () => void) {
	const parts: Uint8Array<ArrayBuffer>[] = [], events: string[] = [];
	const writable = new WritableStream<Uint8Array>({ write(bytes) { parts.push(new Uint8Array(bytes)); events.push('write'); },
		close() { events.push('close'); onClose?.(); }, abort() { events.push('abort'); parts.length = 0; } });
	return { writable, parts, events };
}
export function includesLegacyBackupFailure(value: unknown, reason: unknown): boolean {
	return Object.is(value, reason) || value instanceof AggregateError && (value.errors as unknown[]).some(error => includesLegacyBackupFailure(error, reason));
}
