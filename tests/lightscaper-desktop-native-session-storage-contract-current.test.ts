/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import type { LightscaperNativePhotoSessionLeaseCurrentV1 as NativeLease } from '../desktop/lightscaper-native-photo-session-lease-current-v1.ts';
import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage,
	DesktopPhotoLibrarySessionServiceCurrentV1 as Service } from '../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';

type EveryPropertyRequired<Value> = {
	[Key in keyof Value]-?: object extends Pick<Value, Key> ? Key : never;
}[keyof Value] extends never ? true : false;
type Components = Storage['components'];
type Cube = Awaited<ReturnType<Components['resources']['cubeLutResources']>>;
type Brush = Awaited<ReturnType<Components['resources']['maskRasterResources']>>;

// These assignments fail strict checking if optional browser ports accidentally
// weaken the complete local native service, even when runtime methods exist.
const required: Readonly<{
	catalog: EveryPropertyRequired<Components['catalog']>;
	media: EveryPropertyRequired<Components['media']>;
	settings: EveryPropertyRequired<Components['settings']['settingsRepository']>;
	transport: EveryPropertyRequired<Components['originalTickets']['transport']>;
	cube: EveryPropertyRequired<Cube>;
	brush: EveryPropertyRequired<Brush>;
	importPresets: EveryPropertyRequired<Storage['importPresets']>;
	physicalOriginalsOmitted: 'originals' extends keyof Components ? false : true;
}> = { catalog: true, media: true, settings: true, transport: true, cube: true, brush: true,
	importPresets: true, physicalOriginalsOmitted: true };

void test('Lightscaper complete renderer storage contract accepts an actual selected native lease and local service',
	{ timeout: 15_000, concurrency: false }, async context => {
		let directory: string | undefined, scopes: Scopes | undefined, actual: Readonly<NativeLease> | undefined;
		let deadlineClose: Promise<void> | undefined, localCloses = 0, failed = false, primary: unknown;
		const cancel = (): void => {
			actual?.stop();
			if (scopes && !deadlineClose) { deadlineClose = scopes.close(); void deadlineClose.catch(() => undefined); }
		};
		context.signal.addEventListener('abort', cancel, { once: true });
		try {
			directory = await mkdtemp(join(tmpdir(), 'lightscaper native storage contract '));
			scopes = await Scopes.open({ appDataPath: directory });
			if (context.signal.aborted) cancel(); context.signal.throwIfAborted();
			const manager = scopes;
			const service: Readonly<Service> = Object.freeze<Service>({
				async open(options, localOwner) {
					const selected = await manager.openSelected(options);
					actual = await manager.openSessionLease(selected.scope, localOwner, { signal: options.signal });
					// Project renderer-safe members from the genuine Main lease. The
					// opaque linked/rawParts and physical Originals stay Main-private.
					const { catalog, media, settings, resources, originalTickets } = actual.components;
					const storage: Readonly<Storage> = Object.freeze({ ...actual,
						components: Object.freeze({ catalog, media, settings, resources, originalTickets, close: actual.components.close }),
					});
					return storage;
				},
			});
			const localOwner = Object.freeze({ close(): Promise<void> {
				assert.equal(this, localOwner); localCloses++; return Promise.resolve();
			} });
			const storage = await service.open({ name: 'Native storage contract', signal: context.signal }, localOwner);
			assert.equal(storage.close, actual?.close); assert.equal(storage.components.catalog, actual?.components.catalog); assert.ok(Object.isFrozen(storage));
			assert.match(storage.selectionToken, /^[0-9a-f]{32}$/u);
			assert.ok(storage.signal instanceof AbortSignal);
			const root = await storage.components.catalog.loadCatalog(storage.catalogId); assert.ok(root);
			assert.equal(root.id, storage.catalogId);
			const saved = await storage.exclusive(storage.catalogId, signal =>
				storage.components.catalog.saveCatalog({ ...root, name: 'Typed native durable ACK' }, root.revision, { signal }), context.signal);
			assert.equal(saved.revision, root.revision + 1);
			assert.equal((await storage.components.catalog.loadCatalog(storage.catalogId))?.name, saved.name);
			const settings = storage.components.settings.settingsRepository;
			assert.equal(await settings.putIfAbsent('storage-contract:probe', { value: undefined }), true);
			assert.deepEqual(await settings.readEntry('storage-contract:probe'), { present: true, value: { value: undefined } });
			assert.equal(await storage.components.settings.readImportIntentCurrentV1(storage.catalogId), null);
			const cube = await storage.components.resources.cubeLutResources();
			const brush = await storage.components.resources.maskRasterResources();
			await cube.verifyReferencesV1([]); await brush.verifyReferencesV1([]);
			const transport = storage.components.originalTickets.transport;
			for (const method of [transport.open, transport.read, transport.close, transport.openGroup, transport.readGroup, transport.closeGroup])
				assert.equal(typeof method, 'function');
			const cache = storage.components.media.createBinaryDerivativeCache(PHOTO_PREVIEW_CACHE_PROFILE_V1);
			assert.deepEqual(await cache.trim(context.signal), { removedEntries: 0, removedBytes: 0, more: false });
			assert.equal(typeof storage.components.catalog.captureSmartCollectionArchiveV1, 'function');
			assert.equal(typeof storage.components.media.beginAssetWrite, 'function');
			assert.equal(typeof storage.components.media.inspectCatalogOriginalBody, 'function');
			assert.equal(typeof storage.components.media.restoreCatalogOriginalBody, 'function');
			assert.deepEqual(Object.keys(storage.importPresets).sort(), ['get', 'putIfAbsent', 'readEntry', 'replaceIfCurrent']);
			assert.ok(Object.values(required).every(value => value === true));
			await storage.close(); assert.equal(localCloses, 1);
		} catch (error) { failed = true; primary = error; }
		const cleanup: unknown[] = [];
		for (const close of [() => actual?.close(), () => scopes?.close(), () => deadlineClose]) {
			try { await close(); } catch (error) { cleanup.push(error); }
		}
		context.signal.removeEventListener('abort', cancel);
		if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native storage contract fixture did not retire; files retained.');
		if (directory) await rm(directory, { recursive: true, force: false });
		if (failed) throw primary;
	});
