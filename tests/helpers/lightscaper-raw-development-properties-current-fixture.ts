/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { normalizeImageDevelopStateV1 } from '../../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV4, type ImageDevelopStateThroughV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import type { PhotoLibraryDevelopCommandCurrentV1 } from '../../src/common/editor/photo-library-develop-port-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { generatedDevelopSpecCurrentV1, generatedDevelopCurrentV1, GENERATED_CURRENT_TIME,
	type GeneratedDevelopSpecCurrentV1, type GeneratedDevelopResourcesCurrentV1 } from './lightscaper-develop-properties-current-fixture.ts';
import { recoveryRasterFixture } from './lightscaper-raw-development-raster-export-fixture.ts';
import { LUT_BODY } from './lightscaper-lut-archive-fixture.ts';

export const RAW_PROPERTY_TIME = GENERATED_CURRENT_TIME;
export const RAW_PROPERTY_MODES = ['canonical', 'headroom', 'recovery'] as const;
export type RawPropertyMode = typeof RAW_PROPERTY_MODES[number];
type WithoutSelectedVersion<Command> = Command extends { readonly versionId: string } ? Omit<Command, 'versionId'> : never;
type SelectedCommand = WithoutSelectedVersion<Extract<PhotoLibraryDevelopCommandCurrentV1, {
	readonly type: 'record-develop' | 'save-develop-snapshot' | 'select-develop-history' | 'restore-develop-snapshot';
}>>;
export interface RawPropertySpec { readonly values: GeneratedDevelopSpecCurrentV1; readonly mode: RawPropertyMode }
export const rawPropertySpec: fc.Arbitrary<RawPropertySpec> = fc.record({ values: generatedDevelopSpecCurrentV1,
	mode: fc.constantFrom(...RAW_PROPERTY_MODES) });

/** Existing Process3 generators stay unchanged; this owner adds an actual
 * Process4 source policy and explicit mixed-process controls. */
export function rawPropertyRecipe(spec: RawPropertySpec, resources?: GeneratedDevelopResourcesCurrentV1,
	process: 1 | 2 | 3 | 4 = 4): Readonly<ImageDevelopStateThroughV4> {
	const third = generatedDevelopCurrentV1(spec.values, resources);
	if (process === 3) return third;
	const { repairs, ...second } = third;
	if (process === 2) return normalizeImageDevelopStateV2({ ...second, processVersion: 2 });
	if (process === 1) return normalizeImageDevelopStateV1({ ...second, processVersion: 1,
		effects: third.effects.filter(effect => effect.id === 'white' || effect.id === 'global-tone'), masks: [], maskBindings: [] });
	return normalizeImageDevelopStateV4({ ...third, processVersion: 4, repairs,
		rawDevelopment: { schemaVersion: 1, mode: spec.mode } });
}

/** Genuine owned DNG import and production workers, Current catalog/media and
 * selected Sessions. IDB is instrumented; this is not browser/OS qualification. */
export async function rawDevelopPropertiesFixture() {
	const f = await recoveryRasterFixture();
	try {
		let session = f.session;
		const ids = [f.saved.photoId], brush = (await f.installBrush([0, 96, 255])).reference;
		const unusedBrush = (await f.installBrush([255, 32, 0])).reference;
		const lut = (await session.cubeLuts.importFile(new Blob([new Uint8Array(LUT_BODY)]))).reference;
		const resources = Object.freeze({ brush, unusedBrush, lut });
		type Location = Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>['location'];
		async function location(): Promise<Location> {
			const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
			try { await anchor.ready(); return (await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
				initializeDefault: async () => { throw new Error('Property observation cannot initialize a namespace.'); } })).location;
			} finally { await anchor.close(); }
		}
		async function owners<Result>(run: (media: PhotoMediaStoreV1, catalog: PhotoCatalogRepositoryCurrentV1, selected: Location) => Promise<Result>): Promise<Result> {
			const selected = await location(), media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks,
				databaseName: selected.mediaDatabaseName, preferOpfs: false });
			const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selected.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
			try { await media.ready(); return await run(media, catalog, selected); }
			finally { await Promise.all([catalog.close(), media.close()]); }
		}
		const read = (index = 0) => session.develop.read({ schemaVersion: 3, photoId: ids[index]! });
		const photo = (index = 0) => owners(async (_media, catalog, selected) => {
			const value = await catalog.loadPhoto(selected.catalogId, ids[index]!); assert.ok(value); return value;
		});
		const apply = async (command: SelectedCommand, index = 0) => {
			const before = await read(index); return session.develop.apply({ schemaVersion: 3, photoId: before.photoId,
				expectedRevision: before.revision, command: { ...command, versionId: before.versionId } });
		};
		return { native: f.native, options: f.options, raw: f.raw, ids, resources, location, read, photo, apply,
			get session() { return session; },
			workerCounts: () => ({ canonical: f.canonical.active(), recovery: f.recovery.active() }),
			async addRaw() {
				const outcome = await session.importFiles([new File([f.raw], `Generated-${String(ids.length)}.dng`, { type: 'image/x-adobe-dng' })]);
				assert.equal(outcome[0]?.status, 'imported'); const id = outcome[0]?.photoId; assert.ok(id); ids.push(id); return ids.length - 1;
			},
			async record(develop: ImageDevelopStateThroughV4, index = 0, label = 'Generated source policy') {
				return apply({ type: 'record-develop', develop, label, createdAt: RAW_PROPERTY_TIME }, index);
			},
			async reopen() { await session.close(); session = await createPhotoLibrarySessionCurrentV1(f.options); await session.readPage(); return session; },
			async row() { return owners(async (media, _catalog, selected) => {
				const value: unknown = await media.settingsRepository.get(photoDevelopPresetsKeyV1(selected.catalogId));
				return value === undefined ? null : normalizePhotoDevelopPresetRowCurrentV1(value, selected.catalogId);
			}); },
			async custody() { return owners(async (media, catalog, selected) => {
				const allIds = [...f.photos.map(value => value.id), ...ids], originals = [];
				for (const id of allIds) {
					const value = await catalog.loadPhoto(selected.catalogId, id); assert.ok(value); await media.verifyOriginal(value.original);
					const body = await media.mediaRepository.loadAsset(value.original.storageKey); assert.ok(body instanceof Blob);
					const bytes = new Uint8Array(await body.arrayBuffer());
					assert.equal(createHash('sha256').update(bytes).digest('hex'), value.original.contentSha256);
					originals.push({ original: value.original, bytes: Array.from(bytes) });
				}
				const borrowed: Uint8Array[] = [], bodies = [], masks = await media.getMaskRasterResources(), luts = await media.getCubeLutResources();
				for (const reference of [brush, unusedBrush]) bodies.push(await masks.source.withBytes(reference, bytes => {
					borrowed.push(bytes); return { key: reference.storageKey, bytes: Array.from(bytes) };
				}));
				bodies.push(await luts.source.withBytes(lut, bytes => { borrowed.push(bytes); return { key: lut.storageKey, bytes: Array.from(bytes) }; }));
				assert.ok(borrowed.every(bytes => bytes.every(value => value === 0)));
				const rows = f.native.raw(selected.mediaDatabaseName).records(selected.mediaDatabaseName, 'catalogOriginalRoots') as Record<string, unknown>[];
				const roots = rows.filter(row => allIds.includes(row.photoId as string)).map(row => ({ photoId: row.photoId, catalogId: row.catalogId,
					assetId: row.assetId, sourceId: row.sourceId, sha256: row.sha256, size: row.size, importId: row.importId }));
				assert.equal(roots.length, allIds.length); assert.ok(roots.every(root => root.importId === null));
				return { originals, bodies, roots };
			}); },
			async close() { try { await session.close(); } finally { await f.close(); } },
		};
	} catch (error) { await f.close(); throw error; }
}
