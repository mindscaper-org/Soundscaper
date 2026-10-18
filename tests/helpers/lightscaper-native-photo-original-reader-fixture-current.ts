/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from '../../desktop/lightscaper-native-photo-originals-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoImportIntentKeyV1, normalizePhotoImportIntentV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { managedMediaIntegrationFixtureCurrentV1, managedMediaIntegrationReferenceCurrentV1,
	type ManagedMediaIntegrationFixtureCurrentV1 } from './lightscaper-native-managed-media-integration-fixture-current.ts';
import { nativeWriterInputCurrentV1 } from './lightscaper-native-media-writer-integration-fixture-current.ts';
import { deferred } from './async-test-control.ts';
export { Originals, Media, photoImportIntentKeyV1, normalizePhotoDocumentCurrentV1 };
export { deferred, remainsPending } from './async-test-control.ts';
export const READER_CATALOG_CURRENT_V1 = 'catalog-1';
export const readerShaCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function exactReaderFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	let refused = false;
	await work.then(() => undefined, (error: unknown) => { refused = true; assert.equal(error, expected); });
	assert.equal(refused, true);
}
export function readerIntentCurrentV1(importId: string) {
	return normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId: READER_CATALOG_CURRENT_V1, importId }, READER_CATALOG_CURRENT_V1);
}
export interface ReaderFixtureCurrentV1 extends ManagedMediaIntegrationFixtureCurrentV1 {
	readonly database: DatabaseSync;
	readonly entry: ReturnType<typeof nativeWriterInputCurrentV1>;
	readonly request: { catalogId: string; photoId: string; original: ReturnType<typeof nativeWriterInputCurrentV1>['original'] };
	readonly scope: AbortController;
	readonly reader: Originals;
	readerFor(scope?: AbortController): Originals;
}
export async function nativeOriginalReaderFixtureCurrentV1(run: (fixture: ReaderFixtureCurrentV1) => Promise<void>,
	options: Readonly<{ staged?: string; unretained?: boolean; length?: number }> = {}): Promise<void> {
	await managedMediaIntegrationFixtureCurrentV1(async owner => {
		const entry = nativeWriterInputCurrentV1(701, options.length ?? 2 * 1024 * 1024 + 31);
		await owner.media.writeAsset(entry.original.storageKey, new Blob([entry.bytes]), entry.metadata);
		const reference = managedMediaIntegrationReferenceCurrentV1(entry.original, entry.photo.id);
		if (options.staged) {
			await owner.settings.settingsRepository.put(photoImportIntentKeyV1(READER_CATALOG_CURRENT_V1), readerIntentCurrentV1(options.staged));
			await owner.media.catalogOriginals.stage(READER_CATALOG_CURRENT_V1, options.staged, [reference]);
		} else if (!options.unretained) await owner.media.catalogOriginals.retain(READER_CATALOG_CURRENT_V1, [reference]);
		await owner.catalog.publishPhotos(READER_CATALOG_CURRENT_V1, 0, [entry.photo]);
		const database = new DatabaseSync(owner.originalDatabasePath), readers: Originals[] = [];
		const scope = new AbortController();
		const readerFor = (controller = scope): Originals => {
			const reader = Originals.create({ catalog: owner.catalog, media: owner.media, settings: owner.settings,
				scope: { signal: controller.signal, assertCurrent: () => { controller.signal.throwIfAborted(); } } });
			readers.push(reader); return reader;
		};
		let failed = false, primary: unknown;
		try { await run({ ...owner, entry, request: { catalogId: READER_CATALOG_CURRENT_V1, photoId: entry.photo.id, original: entry.original },
			scope, database, readerFor, reader: readerFor() }); } catch (error) { failed = true; primary = error; }
		const failures: unknown[] = [];
		for (const reader of readers) { try { await reader.close(); } catch (error) { failures.push(error); } }
		try { database.close(); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Original reader fixture retirement failed; files retained.');
		if (failed) throw primary;
	});
}
/** Hold a real native FileHandle.read receipt. Every byte still comes from the
	* actual immutable file. The test joins work before restoring the prototype. */
export async function holdReaderFileReadCurrentV1<Result>(directory: string,
	run: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<Result>): Promise<Result> {
	const witness = await open(join(directory, 'original-reader-handle-witness'), 'wx');
	const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'read');
	assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['read']; await witness.close();
	const entered = deferred<void>(), released = deferred<void>(); let held = false;
	Object.defineProperty(prototype, 'read', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
		const result = Reflect.apply(native, this, args) as ReturnType<FileHandle['read']>;
		return result.then(async value => { if (!held) { held = true; entered.resolve(); await released.promise; } return value; });
	} });
	try { return await run({ entered: entered.promise, release: () => { released.resolve(); } }); }
	finally { released.resolve(); Object.defineProperty(prototype, 'read', descriptor); }
}
