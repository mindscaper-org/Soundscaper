/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { rawDngFixtureV1 } from './lightscaper-raw-dng-current-fixture.ts';
export { nativeResourceRootCurrentV1 as scopeCatalogRootCurrentV1,
	nativeResourceBundleCurrentV1 as scopeResourceBundleCurrentV1,
	installNativeResourceBundleCurrentV1 as installScopeResourceBundleCurrentV1,
	nativeResourcePhotoCurrentV1 as scopeResourcePhotoCurrentV1 } from './lightscaper-native-photo-resources-integration-fixture-current.ts';
export { managedMediaIntegrationReferenceCurrentV1 as scopeOriginalReferenceCurrentV1,
	managedMediaIntegrationReadCurrentV1 as readScopeOriginalCurrentV1 } from './lightscaper-native-managed-media-integration-fixture-current.ts';
export { holdNativeWriterFileWriteCurrentV1 as holdScopeNativeFileWriteCurrentV1 } from './lightscaper-native-media-writer-integration-fixture-current.ts';
export { Scopes };
export type ScopeCurrentV1 = Awaited<ReturnType<Scopes['allocate']>>;
export type ComponentsCurrentV1 = Awaited<ReturnType<Scopes['openComponents']>>;
export const SCOPE_CATALOG_CURRENT_V1 = 'catalog-1';
export const scopeLibraryRootCurrentV1 = (root: string) => join(root, 'Lightscaper', 'project-library', 'v1');
export const scopeGenerationRootCurrentV1 = (root: string, token: string) => join(scopeLibraryRootCurrentV1(root), 'native-photo-libraries', token);
export const scopeAppDataCurrentV1 = (root: string, token: string) => join(scopeGenerationRootCurrentV1(root, token), 'app-data');

/** Actual encoded owned DNGs differ in their real orientation field. No fake
 * body/resource verifier or image decoder is used by this storage fixture. */
export function scopePhotoCurrentV1(orientation: 1 | 3 | 6 = 1) {
	const bytes = rawDngFixtureV1(orientation).bytes, seed = photoArchiveFixture(1, bytes).photo;
	const photo = normalizePhotoDocumentCurrentV1({ ...seed, original: { ...seed.original, name: 'Same key.dng',
		mimeType: 'image/x-adobe-dng', width: 32, height: 32 }, metadata: { ...seed.metadata, fileName: 'Same key.dng' } });
	return { photo, bytes, blob: new Blob([bytes], { type: 'image/x-adobe-dng' }) };
}

export async function nativeScopeIntegrationFixtureCurrentV1(run: (value: Readonly<{
	directory: string; scopes: Scopes; reopen(): Promise<Scopes>;
}>) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper scoped library integration '))), owners: Scopes[] = [];
	const reopen = async (): Promise<Scopes> => { const owner = await Scopes.open({ appDataPath: directory }); owners.push(owner); return owner; };
	let failed = false, primary: unknown;
	try { const scopes = await reopen(); await run({ directory, scopes, reopen }); } catch (error) { failed = true; primary = error; }
	const cleanup: unknown[] = [];
	for (const owner of owners.reverse()) { try { await owner.close(); } catch (error) { cleanup.push(error); } }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Scope integration owners did not retire; files retained.');
	await rm(directory, { recursive: true, force: false }); if (failed) throw primary;
}
