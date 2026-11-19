/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { createLightscaperNativeCatalogRestoreStageCurrentV1 as createCatalog,
	readLightscaperNativeCatalogRestoreReceiptCurrentV1 as catalogReceipt } from '../../desktop/lightscaper-native-catalog-restore-stage-current-v1.ts';
import { createLightscaperNativePhotoMediaRestoreStageCurrentV1 as createMedia } from '../../desktop/lightscaper-native-photo-media-restore-stage-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from '../../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from '../../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as originalPaths } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 as resourcePaths } from '../../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { deriveLightscaperNativePhotoSettingsPathsCurrentV1 as settingsPaths } from '../../desktop/lightscaper-native-photo-settings-database-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { copyImageDevelopSelectedSettingsV4 } from '../../src/common/editor/imaging/image-develop-settings-selected-v4.ts';
import { createImageDevelopSelectedPresetV4 } from '../../src/common/editor/imaging/image-develop-preset-selected-v4.ts';
import { normalizeImageDevelopStateV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { nativeScopeIntegrationFixtureCurrentV1, scopeAppDataCurrentV1, scopeCatalogRootCurrentV1, Scopes,
	scopeResourceBundleCurrentV1, scopeResourcePhotoCurrentV1, scopePhotoCurrentV1,
	holdScopeNativeFileWriteCurrentV1 } from './lightscaper-native-library-scope-integration-fixture-current.ts';
import { deferred } from './async-test-control.ts';
export { remainsPending } from './async-test-control.ts';
export { originalPaths, Media, Resources, Settings, Catalog, catalogReceipt };
export const mediaRestoreShaCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export type MediaRestoreFixtureOptionsCurrentV1 = Readonly<{ preset?: 'full' | 'absent' | 1 | 2 | 3 | 4; length?: number; signal?: AbortSignal }>;

/** Real guarded fresh generation and claims; only the input record/byte
 * producer is a fixture. All body/resource/preset proofs use actual owners. */
export async function nativeMediaRestoreFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>, options: MediaRestoreFixtureOptionsCurrentV1 = {}): Promise<void> {
	await nativeScopeIntegrationFixtureCurrentV1(async native => {
		const input = await records(options), candidate = await native.scopes.beginRestore(input.root.id);
		const appDataPath = scopeAppDataCurrentV1(native.directory, candidate.allocation.namespaceToken);
		let fixture: ReturnType<typeof createFixture> | undefined, failed = false, primary: unknown;
		try {
			const catalog = await createCatalog(candidate.catalogClaim, { root: input.root, savedState: null, signal: context.signal });
			const media = await createMedia(candidate.mediaClaim, { root: input.root,
			developPresets: input.row === null ? null : { rowSchemaVersion: input.row.schemaVersion, revision: input.row.revision, presetCount: input.row.presets.length },
			lutResources: input.bundles.map(bundle => ({ id: bundle.lut.reference.storageKey,
				entry: `assets/luts/${bundle.lut.reference.sha256}.cube`, reference: bundle.lut.reference })),
			maskRasters: input.bundles.flatMap(bundle => bundle.brushes.map(body => ({ id: body.reference.storageKey,
				entry: `assets/masks/${body.reference.sha256}.scmask`, reference: body.reference }))), signal: options.signal ?? context.signal });
			fixture = createFixture(context, appDataPath, input, candidate, catalog, media); await run(fixture);
		} catch (error) { failed = true; primary = error; }
		try { if (fixture) await fixture.close(); else { await candidate.close(); candidate.retireRole('unpublished'); } } catch (cleanup) {
			if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Native media restore test and retirement failed.', { cause: cleanup }); throw cleanup;
		}
		if (failed) throw primary;
	});
}
async function records(options: MediaRestoreFixtureOptionsCurrentV1) {
	const bundles = [] as Awaited<ReturnType<typeof scopeResourceBundleCurrentV1>>[];
	for (let index = 0; index < 7; index++) bundles.push(await scopeResourceBundleCurrentV1(index));
	const rich = scopeResourcePhotoCurrentV1(bundles.slice(0, 6)), first = scopePhotoCurrentV1(1), second = scopePhotoCurrentV1(3);
	const bytes = options.length ? new Uint8Array(Math.max(options.length, first.bytes.length)) : first.bytes.slice(); bytes.set(first.bytes);
	const values = [bytes, bytes, second.bytes], photos = values.map((body, index) => normalizePhotoDocumentCurrentV1({ ...rich,
		id: `restored-photo-${index}`, revision: 5 + index, metadata: { ...rich.metadata, fileName: `Restored ${index}.dng` },
		original: { ...first.photo.original, id: `restored-source-${index}`, name: `Restored ${index}.dng`, storageKey: index < 2 ? 'restore-shared' : 'restore-other',
			contentSha256: mediaRestoreShaCurrentV1(body), byteLength: body.length } }));
	const root = normalizePhotoCatalogRootV1({ ...scopeCatalogRootCurrentV1(), revision: 17, photoCount: photos.length });
	const presetMode = options.preset ?? 'full', presetBundle = bundles[6]!, selected = rich.versions[0]!.develop;
	assert.equal(selected.processVersion, 4);
	const develop = normalizeImageDevelopStateV4({ ...selected,
		effects: [{ id: 'preset-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: presetBundle.lut.reference } }],
		masks: [{ schemaVersion: 2, id: 'preset-unbound', kind: 'matte', name: 'Preset-only brush',
			inputs: presetBundle.brushes.map((body, index) => ({ name: `Paint${index}`, kind: 'alpha', sourceRef: body.reference.storageKey })),
			nodes: [{ id: 'out', kind: 'alpha', inputName: 'Paint0' }], outputNodeId: 'out' }], maskBindings: [] });
	const settings = copyImageDevelopSelectedSettingsV4({ schemaVersion: 4, develop,
		selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true } });
	const preset = createImageDevelopSelectedPresetV4({ schemaVersion: 4, id: 'restore-preset', name: 'Preset-only complete closure', settings });
	const row = presetMode === 'absent' ? null : normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: presetMode === 'full' ? 4 : presetMode,
		kind: 'photo-develop-presets', catalogId: root.id, revision: 29, presets: presetMode === 'full' ? [preset] : [] }, root.id);
	return { root, photos, values, row, bundles: presetMode === 'full' ? bundles : bundles.slice(0, 6) };
}
function createFixture(context: TestContext, appDataPath: string, input: Awaited<ReturnType<typeof records>>,
	candidate: Awaited<ReturnType<Scopes['beginRestore']>>,
	catalog: Awaited<ReturnType<typeof createCatalog>>, media: Awaited<ReturnType<typeof createMedia>>) {
	const releases = new Set<() => void>(), active = new Set<Promise<unknown>>(), extraOwners = new Set<Readonly<{ close(): Promise<void> }>>();
	let closing: Promise<void> | undefined;
	const cancel = (): void => { for (const release of releases) release(); void candidate.close().catch(() => undefined); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	function track<Value>(work: Promise<Value>): Promise<Value> { active.add(work); void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work; }
	return { ...input, candidate, catalog, media, appDataPath,
		paths: { originals: originalPaths(appDataPath), resources: resourcePaths(appDataPath), settings: settingsPaths(appDataPath) },
		consumed: [] as string[],
		chunks(index: number, change?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>): AsyncIterable<Uint8Array<ArrayBuffer>> {
			const bytes = change ? change(input.values[index]!.slice()) : input.values[index]!;
			const photo = input.photos[index]!, consumed = this.consumed;
			return { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) yield bytes.subarray(offset, offset + 4 * 1024 * 1024); consumed.push(photo.id); } };
		},
		writeOriginal(index: number, source?: AsyncIterable<Uint8Array>) { return track(media.writeOriginal(input.photos[index]!, source ?? this.chunks(index))); },
		async writePhotos(): Promise<void> { for (const [index, photo] of input.photos.entries()) { await this.writeOriginal(index); await catalog.writePhoto(photo); } },
		async writeResources(): Promise<void> {
			if (input.row !== null) await media.writeDevelopPresets(input.row);
			for (const bundle of input.bundles) await media.writeLut(bundle.lut.reference, bundle.lut.bytes);
			for (const bundle of input.bundles) for (const body of bundle.brushes) await media.writeMaskRaster(body.reference, body.bytes);
		},
		finish() { return track(media.finish(catalog)); },
		gate() { const entered = deferred<void>(), leave = deferred<void>(); const release = (): void => { entered.resolve(); leave.resolve(); };
			releases.add(release); return { entered: entered.promise, release, async hold() { entered.resolve(); await leave.promise; } }; },
		async reached(barrier: Promise<void>, work: Promise<unknown>): Promise<void> {
			context.signal.throwIfAborted(); await Promise.race([barrier, work.then(() => { throw new Error('Restore ended before its actual lifetime barrier.'); })]); context.signal.throwIfAborted();
		},
		async holdWrite<Result>(run: (control: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<Result>): Promise<Result> {
			return holdScopeNativeFileWriteCurrentV1(appDataPath, async control => { releases.add(control.release);
				try { return await run(control); } finally { control.release(); releases.delete(control.release); } });
		},
		sql(which: 'originals' | 'resources' | 'settings', run: (db: DatabaseSync) => void): void {
			const path = which === 'originals' ? originalPaths(appDataPath) : which === 'resources' ? resourcePaths(appDataPath) : settingsPaths(appDataPath);
			const db = new DatabaseSync(path.databasePath); let failed = false, primary: unknown;
			try { run(db); } catch (error) { failed = true; primary = error; }
			try { db.close(); } catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], 'Native fixture SQL and close failed.', { cause: cleanup }); throw cleanup; }
			if (failed) throw primary;
		},
		async reopen() {
			await candidate.close(); const resources = await Resources.open({ appDataPath }); extraOwners.add(resources);
			const media = await Media.open({ appDataPath }); extraOwners.add(media);
			const settings = await Settings.open({ appDataPath, scope: 'selected:library' }); extraOwners.add(settings);
			const catalog = await Catalog.open({ appDataPath, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resources, signal) }); extraOwners.add(catalog);
			return { resources, media, settings, catalog };
		},
		close(): Promise<void> {
			closing ??= Promise.resolve().then(async () => {
				context.signal.removeEventListener('abort', cancel); for (const release of releases) release(); const failures: unknown[] = [];
				try { await candidate.close(); } catch (error) { failures.push(error); } await Promise.allSettled([...active]);
				for (const owner of [...extraOwners].reverse()) { try { await owner.close(); } catch (error) { failures.push(error); } }
				if (!failures.length) { try { candidate.retireRole('unpublished'); } catch (error) { failures.push(error); } }
				if (failures.length) throw new AggregateError(failures, 'Native restore fixture owners did not retire.');
			}); return closing;
		},
	};
}
