/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service } from '../../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { PhotoLibrarySessionCurrentV1 as Session } from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV1 } from '../../src/common/editor/imaging/image-develop-state-v1.ts';
import { encodeImageHdrOriginalV1 } from '../../src/common/editor/imaging/image-hdr-original-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths, lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import { originalGroupFixtureCurrentV1 } from './lightscaper-desktop-original-group-fixture-current.ts';
import { scopePhotoCurrentV1, scopeResourceBundleCurrentV1, installScopeResourceBundleCurrentV1,
	scopeResourcePhotoCurrentV1, scopeOriginalReferenceCurrentV1 as reference } from './lightscaper-native-library-scope-integration-fixture-current.ts';
export { remainsPending } from './async-test-control.ts';
export { Session, Scopes };
export const runtimeShaCurrentV1 = (value: unknown): string => {
	assert.ok(value instanceof Uint8Array); return createHash('sha256').update(value).digest('hex');
};
type Lease = Awaited<ReturnType<Scopes['openSessionLease']>>;
type Photo = ReturnType<typeof normalizePhotoDocumentCurrentV1>;

/** Real Main owners and service, production renderer factory/OriginalSource,
 * actual File snapshots. Only the OPFS directory operations are bounded test
 * ports; no native service, body/resource verifier or decoder is replaced. */
export async function nativeSessionRuntimeFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper complete native Session ')));
	let fixture: Awaited<ReturnType<typeof createFixture>> | undefined, initial: Scopes | undefined, failed = false, primary: unknown;
	const cancel = (): void => { fixture?.cancel(); if (initial) void initial.close().catch(() => undefined); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	try {
		initial = await Scopes.open({ appDataPath: directory }); fixture = await createFixture(context, directory, initial); await run(fixture);
	} catch (error) { failed = true; primary = error; }
	const errors: unknown[] = [];
	try { fixture?.cancel(); await fixture?.close(); } catch (error) { errors.push(error); }
	try { await initial?.close(); } catch (error) { errors.push(error); }
	context.signal.removeEventListener('abort', cancel);
	if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Complete native Session fixture did not retire; files retained.');
	await rm(directory, { recursive: true, force: false }); if (failed) throw primary;
}

async function createFixture(context: TestContext, directory: string, first: Scopes) {
	const selected = await first.openSelected({ name: 'Native complete Session' }), seed = await first.openComponents(selected.scope);
	let photos: readonly Photo[] = [], raw = new Uint8Array(0), hdr = new Uint8Array(0);
	const resource = await scopeResourceBundleCurrentV1(8);
	let failed = false, primary: unknown;
	try {
		await installScopeResourceBundleCurrentV1(seed.resources, resource);
		const entry = scopePhotoCurrentV1(), rich = scopeResourcePhotoCurrentV1(Array.from({ length: 6 }, () => resource)); raw = new Uint8Array(entry.bytes);
		const aliases = [0, 1].map(index => normalizePhotoDocumentCurrentV1({ ...rich, catalogId: selected.catalogId, id: `runtime-photo-${index}`, collectionIds: ['manual'],
			original: { ...entry.photo.original, id: `runtime-original-${index}`, storageKey: 'runtime-shared' }, metadata: entry.photo.metadata }));
		const descriptor = { schemaVersion: 1, width: 32, height: 32, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' } as const;
		const samples = new Float32Array(descriptor.width * descriptor.height * 4);
		for (let offset = 0; offset < samples.length; offset += 4) {
			if ((offset / 4) % 2 === 0) { samples[offset] = 3; samples[offset + 1] = .5; } samples[offset + 3] = 1;
		}
		try { hdr = new Uint8Array(await encodeImageHdrOriginalV1({ descriptor, pixels: samples }, {
			schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: 0 },
			inputs: aliases.map((photo, index) => ({ product: 'lightscaper', ownerId: photo.catalogId, sourceId: photo.original.id, revision: photo.revision,
				original: { fileName: photo.original.name, mimeType: photo.original.mimeType!, sha256: photo.original.contentSha256!, byteLength: raw.byteLength, width: 32, height: 32 },
				profile: 'linear-srgb16', exposureMultiplier: index === 0 ? 1 : .25, offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 1 })),
			output: { x: 0, y: 0, width: 32, height: 32 },
		})); } finally { samples.fill(0); }
		const develop = normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
			rawDevelopment: { schemaVersion: 1, mode: 'canonical' }, repairs: { schemaVersion: 1, spots: [] } });
		const high = normalizePhotoDocumentCurrentV1({ ...entry.photo, schemaVersion: 3, catalogId: selected.catalogId, id: 'runtime-hdr', collectionIds: ['manual'],
			original: { ...entry.photo.original, id: 'runtime-hdr-original', storageKey: 'runtime-hdr-asset', name: 'Actual merged.lshdr', mimeType: 'image/x-lightscaper-hdr',
				width: 32, height: 32, hasAlpha: false, contentSha256: runtimeShaCurrentV1(hdr), byteLength: hdr.length },
			metadata: { ...entry.photo.metadata, fileName: 'Actual merged.lshdr' }, versions: entry.photo.versions.map(version => ({ ...version, develop })) });
		photos = [...aliases, high]; const root = await seed.catalog.loadCatalog(selected.catalogId); assert.ok(root);
		const updated = await seed.catalog.saveCatalog({ ...root, collections: [{ id: 'manual', name: 'All native aliases', kind: 'manual' }] }, root.revision);
		await seed.media.writeAsset('runtime-shared', entry.blob, { name: aliases[0]!.original.name, mimeType: entry.blob.type });
		await seed.media.writeAsset('runtime-hdr-asset', new Blob([hdr], { type: high.original.mimeType! }), { name: high.original.name, mimeType: high.original.mimeType });
		await seed.media.catalogOriginals.retain(selected.catalogId, photos.map(photo => reference(photo.original, photo.id)));
		await seed.catalog.publishPhotos(selected.catalogId, updated.revision, photos);
	} catch (error) { failed = true; primary = error; }
	try { await seed.close(); } catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Actual runtime seed did not retire.', { cause: cleanup }); }
	if (failed) throw primary;
	const storage = originalGroupFixtureCurrentV1(context), stop = new AbortController(), gates = new Set<() => void>();
	const managers = new Set<Scopes>([first]), sessions = new Set<Session>(), leases: Lease[] = [], pending = new Set<Promise<unknown>>();
	let manager = first, closing: Promise<void> | undefined, opens = 0, localCloses = 0;
	const hooks = { opened: async (_lease: Lease): Promise<void> => undefined };
	const service: Service = { async open(options, localOwner) {
		assert.equal(this, service); opens++; const name = options.name, signal = options.signal, close = localOwner.close, actualManager = manager;
		const local = { close: (): Promise<void> => { localCloses++; return Reflect.apply(close, localOwner, []) as Promise<void>; } };
		const selection = await actualManager.openSelected({ name, ...(signal ? { signal } : {}) });
		const lease = await actualManager.openSessionLease(selection.scope, local, signal ? { signal } : {}); leases.push(lease); await hooks.opened(lease); return lease;
	} };
	const release = (): void => { for (const done of gates) done(); };
	const cancel = (): void => { release(); stop.abort(context.signal.reason); for (const session of sessions) void session.close().catch(() => undefined); };
	const track = <Result>(work: Promise<Result>): Promise<Result> => { pending.add(work); void work.then(() => { pending.delete(work); }, () => { pending.delete(work); }); return work; };
	return { directory, selected, photos, resource, raw, hdr, storage, service, hooks, leases, cancel, release,
		get scopes() { return manager; }, get components() { const lease = leases.at(-1); assert.ok(lease); return lease.components; },
		counts: () => ({ opens, localCloses }),
		gate() { const gate = storage.gate(); gates.add(gate.release); return gate; },
		async reached(barrier: Promise<void>, work: Promise<unknown>): Promise<void> {
			context.signal.throwIfAborted(); await Promise.race([barrier, work.then(() => { throw new Error('Runtime operation ended before actual barrier.'); })]); context.signal.throwIfAborted();
		}, track,
		open(signal = stop.signal): Promise<Session> {
			return track(import('../../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts').then(async module => {
				const session = await module.createDesktopPhotoLibrarySessionCurrentV1({ name: 'Native complete Session', service, signal,
					originalSourceOptions: { storage: storage.storage } }); sessions.add(session); return session;
			}));
		},
		async reopen(): Promise<void> {
			await Promise.all([...sessions].map(session => session.close())); await manager.close(); manager = await Scopes.open({ appDataPath: directory }); managers.add(manager);
		},
		async corruptLegacy(photo: Photo): Promise<void> {
			assert.ok(photo.original.contentSha256); const bytes = (photo.id === 'runtime-hdr' ? hdr : raw).slice(); bytes[bytes.length - 1] = bytes.at(-1)! ^ 1;
			try { await writeFile(bodyPath(paths(directory), photo.original.contentSha256), bytes); } finally { bytes.fill(0); }
		},
		close(): Promise<void> {
			closing ??= Promise.resolve().then(async () => {
				cancel(); await Promise.allSettled([...pending]); const errors: unknown[] = [];
				for (const owner of [...sessions, ...managers, storage]) { try { await owner.close(); } catch (error) { errors.push(error); } }
				if (errors.length) throw new AggregateError(errors, 'Actual runtime construction/Session/Source/storage retirement failed.');
			}); return closing;
		},
	};
}
