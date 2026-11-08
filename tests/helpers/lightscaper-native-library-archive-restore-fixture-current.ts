/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { exportPhotoLibraryBackupCurrentV1 } from '../../src/lightscaper/controller/photo-library-backup-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDevelopPresetRowV4 } from '../../src/lightscaper/storage/photo-develop-preset-row-v4.ts';
import { photoDevelopPresetsKeyV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { scopedCollectionNativeFixtureCurrentV1 } from './lightscaper-scoped-collection-originals-integration-fixture-current.ts';

export const nativeRestoreJsonShaCurrentV1 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Actual native source catalog/resources/custody and production staged File
 * loading feed the existing archive writer. No successful verifier, decoder
 * or archive input is fabricated by this fixture. */
export async function nativeRestoreArchiveCurrentV1(context: TestContext, presets = true) {
	let result: Awaited<ReturnType<typeof createArchive>> | undefined;
	await scopedCollectionNativeFixtureCurrentV1(context, async source => { result = await createArchive(source, context.signal, presets); });
	assert.ok(result); return result;
}
async function createArchive(source: Parameters<Parameters<typeof scopedCollectionNativeFixtureCurrentV1>[1]>[0], signal: AbortSignal, presets: boolean) {
	const c = source.components, catalogId = source.photos[0]!.catalogId;
	const edited = await c.catalog.savePhoto(normalizePhotoDocumentCurrentV1({ ...source.photos[0]!,
		metadata: { ...source.photos[0]!.metadata, caption: 'Preserved exact restored revision' } }), source.photos[0]!.revision, { signal });
	const initial = await c.catalog.loadCatalog(catalogId); assert.ok(initial);
	const stack = await c.catalog.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId,
		id: 'restored-stack', revision: 0, photoIds: [source.photos[1]!.id, edited.id], coverPhotoId: edited.id }), null,
	{ expectedCatalogRevision: initial.revision, expectedStateRevision: 0, signal });
	const presetRow = presets ? normalizePhotoDevelopPresetRowV4({ schemaVersion: 4, kind: 'photo-develop-presets', catalogId, revision: 7, presets: [] }, catalogId) : null;
	if (presetRow) await c.settings.settingsRepository.put(photoDevelopPresetsKeyV1(catalogId), presetRow);
	const root = await c.catalog.loadCatalog(catalogId); assert.ok(root);
	const photos = [] as typeof source.photos;
	for (const previous of source.photos) { const photo = await c.catalog.loadPhoto(catalogId, previous.id); assert.ok(photo); photos.push(photo); }
	const saved = await c.catalog.loadSmartCollection(catalogId, 'saved', { signal }); assert.ok(saved);
	const savedState = await c.catalog.readSmartCollectionState(catalogId, { signal });
	const lut = await c.resources.cubeLutResources(), masks = await c.resources.maskRasterResources();
	const exported = await exportPhotoLibraryBackupCurrentV1(catalogId, { catalog: c.catalog, stacks: c.catalog, originalSource: source.source,
		developPresetSettings: c.settings.settingsRepository, lutResources: lut.source, maskRasters: masks.source },
	{ signal, maximumBlobBytes: 8 * 1024 * 1024 });
	assert.ok(exported.blob); assert.equal(exported.document.schemaVersion, 8); assert.ok(exported.blob.size <= 8 * 1024 * 1024);
	return { blob: exported.blob, root, photos, stack, saved, savedState, presetRow, document: exported.document };
}

/** One target app-level manager. Deadlines release every held barrier and
 * start real manager cancellation; cleanup joins work before removing files. */
export async function nativeArchiveRestoreTargetCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createTarget>>) => Promise<void>): Promise<void> {
	const target = await createTarget(context); let failed = false, primary: unknown;
	try { await run(target); } catch (error) { failed = true; primary = error; }
	try { await target.close(); } catch (cleanup) {
		if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Native restore test and actual retirement failed.', { cause: cleanup }); throw cleanup;
	}
	if (failed) throw primary;
}
async function createTarget(context: TestContext) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-native-archive-restore-')));
	const controller = new AbortController(), jobs = new Set<Promise<unknown>>(), gates = new Set<() => void>();
	let scopes: Scopes | undefined, closing: Promise<void> | undefined;
	const release = (): void => { for (const done of gates) done(); };
	const cancel = (): void => { release(); controller.abort(context.signal.reason); void scopes?.close().catch(() => undefined); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	try { scopes = await Scopes.open({ appDataPath: directory }); }
	catch (primary) { context.signal.removeEventListener('abort', cancel); throw primary; }
	return { directory, signal: controller.signal, get scopes(): Scopes { return scopes!; },
		gate() { let done!: () => void; const promise = new Promise<void>(resolve => { done = resolve; }); gates.add(done); return { promise, release: done }; },
		track<Result>(job: Promise<Result>): Promise<Result> { jobs.add(job); void job.then(() => { jobs.delete(job); }, () => { jobs.delete(job); }); return job; },
		async reached(barrier: Promise<void>, job: Promise<unknown>): Promise<void> {
			controller.signal.throwIfAborted(); await Promise.race([barrier, job.then(() => { throw new Error('Restore ended before the actual barrier.'); })]); controller.signal.throwIfAborted();
		},
		async reopen(): Promise<void> { await scopes!.close(); controller.signal.throwIfAborted(); scopes = await Scopes.open({ appDataPath: directory }); },
		close(): Promise<void> { closing ??= Promise.resolve().then(async () => {
			release(); controller.abort(); const errors: unknown[] = [];
			try { await scopes!.close(); } catch (error) { errors.push(error); }
			await Promise.allSettled([...jobs]); context.signal.removeEventListener('abort', cancel);
			if (errors.length) throw new AggregateError(errors, 'Native restore fixture owners did not retire; files retained.');
			await rm(directory, { recursive: true, force: false });
		}); return closing; },
	};
}
