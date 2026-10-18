/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from '../../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 } from '../../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 } from '../../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import { withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { parseCubeLutV1, type VideoCubeLutReferenceV1 } from '../../src/common/editor/video-color-cube-lut-v27.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';

export interface NativeResourceBodyCurrentV1<Reference = VideoCubeLutReferenceV1 | BrushMaskResourceReferenceV1> {
	readonly reference: Readonly<Reference>; readonly bytes: Uint8Array<ArrayBuffer>;
}
export type NativeResourceFamilyCurrentV1 = 'lut' | 'brush';
export interface NativeResourceBundleCurrentV1 {
	readonly lut: NativeResourceBodyCurrentV1<VideoCubeLutReferenceV1>;
	readonly brushes: readonly NativeResourceBodyCurrentV1<BrushMaskResourceReferenceV1>[];
}
export async function nativeResourceBundleCurrentV1(index: number): Promise<NativeResourceBundleCurrentV1> {
	const bytes = new TextEncoder().encode(`TITLE "Native resource ${index}"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`), parsed = parseCubeLutV1(new TextDecoder().decode(bytes));
	const lut = { bytes, reference: { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax } };
	const brushes = [] as NativeResourceBodyCurrentV1<BrushMaskResourceReferenceV1>[];
	for (let offset = 0; offset < 2; offset++) await withPreparedBrushMaskResourceV1({ width: 3, height: 1,
		alpha: Uint8Array.of(10 + index * 2 + offset, 80 + offset, 220 - index) }, body => {
		brushes.push({ reference: body.reference, bytes: body.bytes.slice() });
	});
	return { lut, brushes };
}
const TIME = '2026-10-18T00:00:00.000Z';
function recipe(bundle: NativeResourceBundleCurrentV1) {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
		rawDevelopment: { schemaVersion: 1, mode: 'canonical' }, repairs: { schemaVersion: 1, spots: [] },
		effects: [{ id: 'disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: bundle.lut.reference } }],
		masks: [{ schemaVersion: 2, id: 'unbound', name: 'Retained unbound brush', kind: 'matte', inputs: [
			{ name: 'Used', kind: 'alpha', sourceRef: bundle.brushes[0]!.reference.storageKey },
			{ name: 'Unused', kind: 'raster', sourceRef: bundle.brushes[1]!.reference.storageKey }],
			nodes: [{ id: 'out', kind: 'alpha', inputName: 'Used' }], outputNodeId: 'out' }], maskBindings: [] });
}
export function nativeResourcePhotoCurrentV1(bundles: readonly NativeResourceBundleCurrentV1[]) {
	assert.equal(bundles.length, 6); const seed = photoArchiveFixture(1).photo, version = seed.versions[0]!;
	const values = bundles.map(recipe), entry = (develop: unknown) => ({ label: 'Retained', createdAt: TIME, develop });
	const snapshot = (develop: unknown, id: string) => ({ id, name: 'Retained snapshot', createdAt: TIME, develop });
	return normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3, versions: [{ ...version, develop: values[0],
		workspace: { schemaVersion: 4, kind: 'photo-develop-workspace', cursor: 0,
			entries: [entry(values[0]), entry(values[1])], snapshots: [snapshot(values[2], 'master-snapshot')] } },
	{ ...version, id: 'inactive-copy', kind: 'virtual-copy', name: 'Inactive copy', develop: values[3],
		workspace: { schemaVersion: 4, kind: 'photo-develop-workspace', cursor: 0,
			entries: [entry(values[3]), entry(values[4])], snapshots: [snapshot(values[5], 'copy-snapshot')] } }] });
}
export const nativeResourceRootCurrentV1 = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
	kind: 'photo-catalog', id: 'catalog-1', name: 'Native resource integration', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
export const nativeResourceOriginalBytesCurrentV1 = async function* () { yield Uint8Array.of(1, 2, 3); };
export async function installNativeResourceBundleCurrentV1(resources: Resources, bundle: NativeResourceBundleCurrentV1) {
	const luts = await resources.cubeLutResources(), brushes = await resources.maskRasterResources();
	await luts.put(bundle.lut.reference, bundle.lut.bytes);
	for (const body of bundle.brushes) await brushes.put(body.reference, body.bytes);
}
export function nativeResourceCatalogFootprintCurrentV1(database: DatabaseSync) {
	return Object.fromEntries(['native_photo_catalogs', 'native_photos', 'native_photo_memberships', 'native_photo_query_rows_v1',
		'native_photo_query_builds_v1', 'native_photo_query_rows_v2', 'native_photo_query_builds_v2']
		.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
}
export function assertNativeResourceClosureCurrentV1(photo: unknown, bundles: readonly NativeResourceBundleCurrentV1[]): void {
	const collector = createPhotoResourceReachabilityCurrentV1(); collector.addPhoto(photo); const closure = collector.finish();
	assert.deepEqual(new Set(closure.luts.map(value => value.storageKey)), new Set(bundles.map(value => value.lut.reference.storageKey)));
	assert.deepEqual(new Set(closure.brushes.map(value => value.storageKey)), new Set(bundles.flatMap(value => value.brushes.map(body => body.reference.storageKey))));
}
export async function nativeResourceIntegrationFixtureCurrentV1(run: (value: {
	directory: string; resourcePath: string; resources: Resources; store: Store; catalog: DatabaseSync; bodies: DatabaseSync;
	bundles: readonly NativeResourceBundleCurrentV1[]; photo: ReturnType<typeof nativeResourcePhotoCurrentV1>;
}) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native resource integration ü ')));
	let resources: Resources | undefined, store: Store | undefined, catalog: DatabaseSync | undefined, bodies: DatabaseSync | undefined;
	let failed = false, primary: unknown;
	try {
		resources = await Resources.open({ appDataPath: directory }); const selected = resources;
		store = await Store.open({ appDataPath: directory, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, selected, signal) });
		await store.createCatalog(nativeResourceRootCurrentV1());
		catalog = new DatabaseSync(deriveLightscaperNativeCatalogPathsCurrentV1(directory).databasePath);
		const resourcePath = deriveLightscaperNativePhotoResourcePathsCurrentV1(directory).databasePath; bodies = new DatabaseSync(resourcePath);
		const bundles = [] as NativeResourceBundleCurrentV1[];
		for (let index = 0; index < 6; index++) bundles.push(await nativeResourceBundleCurrentV1(index));
		await run({ directory, resourcePath, resources, store, catalog, bodies, bundles, photo: nativeResourcePhotoCurrentV1(bundles) });
	} catch (error) { failed = true; primary = error; }
	const failures: unknown[] = [];
	try { catalog?.close(); } catch (error) { failures.push(error); }
	try { bodies?.close(); } catch (error) { failures.push(error); }
	try { await store?.close(); } catch (error) { failures.push(error); }
	try { await resources?.close(); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError(failed ? [primary, ...failures] : failures, 'Native resource integration retirement failed; files retained.');
	if (failed) throw primary;
	await rm(directory, { recursive: true, force: false });
}
