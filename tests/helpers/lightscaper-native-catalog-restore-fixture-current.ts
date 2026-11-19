/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { createLightscaperNativeCatalogRestoreStageCurrentV1 as createStage } from '../../desktop/lightscaper-native-catalog-restore-stage-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';

export function catalogRestoreRecordsCurrentV1(count = 3) {
	const photos = Array.from({ length: count }, (_, index) => {
		const photo = photoArchiveFixture(index + 1).photo;
		return normalizePhotoDocumentCurrentV1({ ...photo, schemaVersion: index % 3 + 1, revision: index + 7,
			metadata: { ...photo.metadata, title: `Kept ${String(index)}` } });
	});
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Restored \ud800 catalog', revision: 29, photoCount: count,
		folders: [], keywords: [], collections: [] });
	const stack = count < 2 ? null : normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id,
		id: 'stack-1', revision: 19, photoIds: [photos[1]!.id, photos[0]!.id], coverPhotoId: photos[0]!.id });
	const saved = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id,
		id: 'saved-1', name: 'Preserved \udfff saved', revision: 23, query: { schemaVersion: 2, kind: 'photo-catalog-query',
			text: '', filter: null, sort: { field: 'photo-id', direction: 'ascending' }, predicate: null } });
	return { root, photos, stack, saved };
}
export type CatalogRestoreFixtureCurrentV1 = Readonly<{
	directory: string; scopes: Scopes; signal: AbortSignal; abort(reason: unknown): void;
	create(root: unknown, savedState?: unknown): Promise<Readonly<{
		candidate: Awaited<ReturnType<Scopes['beginRestore']>>; stage: Awaited<ReturnType<typeof createStage>>; database: DatabaseSync;
	}>>;
}>;
/** Real guarded generation, fresh production claim and independent SQLite
 * observer. No fake database, ownership token or verifier enters this fixture. */
export async function nativeCatalogRestoreFixtureCurrentV1(context: TestContext,
	run: (value: CatalogRestoreFixtureCurrentV1) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper catalog restore ')));
	const controller = new AbortController(), owners: Array<{ close(): Promise<void> }> = [], databases: DatabaseSync[] = [];
	const cancel = (): void => { controller.abort(context.signal.reason); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	let failed = false, primary: unknown, previous: Awaited<ReturnType<Scopes['beginRestore']>> | null = null;
	try {
		const scopes = await Scopes.open({ appDataPath: directory }); owners.push(scopes);
		await run({ directory, scopes, signal: controller.signal, abort: reason => { controller.abort(reason); }, create: async (root, savedState = null) => {
			controller.signal.throwIfAborted();
			if (previous) { await previous.close(); previous.retireRole('unpublished'); previous = null; }
			const admitted = normalizePhotoCatalogRootV1(root);
			const candidate = await scopes.beginRestore(admitted.id, { signal: controller.signal }); previous = candidate; owners.push({ close: async () => { await candidate.close(); candidate.retireRole('unpublished'); } });
			const stage = await createStage(candidate.catalogClaim, { root: admitted, savedState, signal: controller.signal }); owners.push(stage);
			const path = join(directory, 'Lightscaper', 'project-library', 'v1', 'native-photo-libraries', candidate.allocation.namespaceToken,
				'app-data', 'Lightscaper', 'project-library', 'v1', 'native-photo-catalogs.sqlite3');
			const database = new DatabaseSync(path); databases.push(database); return { candidate, stage, database };
		} });
	} catch (error) { failed = true; primary = error; }
	controller.abort(); const cleanup: unknown[] = [];
	for (const database of databases.reverse()) { try { database.close(); } catch (error) { cleanup.push(error); } }
	for (const owner of owners.reverse()) { try { await owner.close(); } catch (error) { cleanup.push(error); } }
	context.signal.removeEventListener('abort', cancel);
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Catalog restore owners did not retire; files retained.');
	await rm(directory, { recursive: true, force: false }); if (failed) throw primary;
}
export async function fillCatalogRestoreCurrentV1(stage: Awaited<ReturnType<typeof createStage>>, records: ReturnType<typeof catalogRestoreRecordsCurrentV1>, saved = false): Promise<void> {
	for (const photo of records.photos) await stage.writePhoto(photo);
	if (records.stack) await stage.writeStack(records.stack);
	if (saved) await stage.writeSavedCollection(records.saved);
}
export function scalarCatalogRestoreCountsCurrentV1(database: DatabaseSync): Record<string, unknown> {
	return Object.fromEntries(['native_photo_catalogs', 'native_photos', 'native_photo_memberships', 'native_photo_query_rows_v1', 'native_photo_query_rows_v2',
		'native_photo_stacks', 'native_photo_stack_forward_members', 'native_photo_stack_memberships', 'native_photo_smart_collections', 'native_photo_smart_collection_summaries']
		.map(table => [table, database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n]));
}
export async function assertOpaqueCatalogRestoreFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	await work.then(() => { assert.fail('Expected the exact opaque refusal.'); }, (reason: unknown) => { assert.equal(reason, expected); });
}
