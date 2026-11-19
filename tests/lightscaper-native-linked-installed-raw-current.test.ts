/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LightscaperNativePhotoHostServicesCurrentV1 as Host } from '../desktop/lightscaper-native-photo-host-services-current-v1.ts';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { createDesktopPhotoLibrarySessionServiceCurrentV1 as client } from '../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import { createDesktopPhotoLibrarySessionCurrentV1 as createSession } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import { getDesktopPhotoLinkedLibraryCurrentV1 as linked } from '../src/lightscaper/desktop-photo-linked-library-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { installLightscaperManagedSmokeRawObserverCurrentV1 as observeRaw } from '../desktop/lightscaper-managed-smoke-native-raw-current-v1.ts';
import { grantedFsPathCurrentV1 as nativePath } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
import { photoNativeDeploymentFixtureCurrentV1 as fixture, PHOTO_NATIVE_TEST_CURRENT_V1 as options, photoNativeHashCurrentV1 as hash } from './helpers/lightscaper-photo-native-deployment-fixture-current.ts';
import { originalGroupFixtureCurrentV1 as opfs } from './helpers/lightscaper-desktop-original-group-fixture-current.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';

void test('Actual installed native FS and isolated RAW services compose through genuine linked Current import and joined publication', options, async context => fixture(context, async f => {
	await f.stage();
	const sources = join(f.directory, 'linked-inputs'), appDataPath = join(f.directory, 'selected-native-library');
	await mkdir(sources); await mkdir(appDataPath); const dng = rawDngFixtureV1(), fileName = 'Installed linked Bayer.dng'; dng.sensor.fill(0);
	await writeFile(join(sources, fileName), dng.bytes, { flag: 'wx', mode: 0o600 });
	const storage = f.own(opfs(context)), observation = f.own(observeRaw());
	const host = f.own(new Host({ applicationRoot: f.applicationRoot, resourcesPath: join(f.directory, 'resources'), packaged: false,
		chooseLinkedRoot: async () => ({ path: nativePath(sources), displayName: 'Actual installed linked input' }) }));
	const scopes = f.own(await Scopes.open({ appDataPath, services: await host.services() }));
	const selected = await scopes.openSelected({ name: 'Actual installed linked RAW' });
	const main = new Main(scopes), closeMain = main.closeAll.bind(main), documentOwner = Object.freeze({}), controls = new Map<string, (kind: 'stop' | 'retire') => Promise<void>>();
	f.own(Object.freeze({ close: closeMain }));
	const service = client({ installRetirement(id, handler) { controls.set(id, handler); return () => { controls.delete(id); }; },
		async invoke(channel, payload) {
			if (channel === channels.open) {
				assert.ok(payload && typeof payload === 'object'); const id: unknown = Reflect.get(payload, 'openId'); assert.ok(typeof id === 'string');
				const retire = controls.get(id); assert.ok(retire); return main.open(documentOwner, payload, { close: () => retire('retire') });
			}
			return main.dispatch(channel, documentOwner, payload);
		} });
	let session: Awaited<ReturnType<typeof createSession>> | undefined;
	const cancel = (): void => { main.stop(documentOwner); if (session) void session.close().catch(() => undefined); };
	f.scope.signal.addEventListener('abort', cancel, { once: true });
	try {
		session = f.own(await f.track(createSession({ name: 'Actual installed linked RAW', service, signal: f.scope.signal, originalSourceOptions: { storage: storage.storage } })));
		await session.readPage(); const runtime = linked(session); assert.ok(runtime);
		const grant = await runtime.chooseFolder(); assert.ok(grant); const scan = await runtime.openScan(grant.grantId);
		let photoId: string;
		try {
			const page = await runtime.nextScan(scan), entry = page.entries.find(value => value.displayName === fileName); assert.ok(entry);
			const items = await f.track(runtime.importEntries({ scan, entryIds: [entry.entryId] }));
			context.diagnostic(JSON.stringify({ actualImport: items.map(item => ({ status: item.status, message: item.message })) }));
			assert.equal(items.length, 1); assert.equal(items[0]?.status, 'imported', 'Actual linked/native per-file refusal must not be silently accepted.');
			const id = items[0]?.photoId; assert.ok(id); photoId = id;
		} finally { await runtime.closeScan(scan); }
		await session.close(); await closeMain();
		const actual = observation.snapshot();
		assert.equal(actual.decoded, 1); assert.equal(actual.wiped, 1); assert.ok(actual.retired >= 1); assert.equal(actual.active, 0);
		assert.ok(actual.samples.some(sample => sample.mode === 'neutral' && sample.format === 'rgba16le' && sample.width === 32 && sample.height === 32));
		const components = await scopes.openComponents(selected.scope);
		try {
			const stored = await components.catalog.loadPhoto(selected.catalogId, photoId); assert.ok(stored);
			assert.equal(stored.original.retention, 'linked'); assert.equal(stored.original.name, fileName);
			assert.equal(stored.original.contentSha256, hash(dng.bytes)); assert.equal(stored.original.byteLength, dng.bytes.byteLength);
			const observed = await f.track(components.originals.withOriginal({ catalogId: selected.catalogId, photoId, original: stored.original }, async view => {
				const digest = createHash('sha256');
				for (let offset = 0; offset < stored.original.byteLength; offset += 1048576) {
					const length = Math.min(1048576, stored.original.byteLength - offset), bytes: Uint8Array = await view.read(offset, length);
					try { assert.equal(bytes.byteLength, length); digest.update(bytes); } finally { bytes.fill(0); }
				}
				return digest.digest('hex');
			}, { signal: f.scope.signal }));
			assert.equal(observed, hash(dng.bytes));
			const roots = await components.media.catalogOriginals.readPage({ catalogId: selected.catalogId });
			assert.ok(roots.roots.some(root => root.photoId === photoId && root.importId === null));
		} finally { await components.close(); }
	} finally {
		try { await session?.close(); } finally { try { await closeMain(); } finally { f.scope.signal.removeEventListener('abort', cancel); dng.bytes.fill(0); } }
	}
}));
