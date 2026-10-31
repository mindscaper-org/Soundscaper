/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { withScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import { PHOTO_MASK_RASTER_ASSET_KIND_V1 as MASK } from '../src/common/editor/scape-photo-mask-raster-v1.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-catalog-pack.ts';
import { PHOTO_STACK_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-smart-collection-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-develop-preset-pack.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND } from '../src/common/editor/scape-photo-cube-lut.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createFramescaperScapeProjectAssetExtension } from '../src/framescaper/editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { stackArchiveRoot } from './helpers/lightscaper-stack-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const OPTIONS = { timeout: 15_000 };

test('actual complete Frame archive runtime keeps a genuine Light catalog opaque and copies the exact producer archive with its installed shared mask kind', OPTIONS, async t => {
	const f = await fixture(t), extension = createFramescaperScapeProjectAssetExtension(PROFILE);
	assert.ok(extension.assetKinds.includes(MASK));
	const envelope = await read(f.archive, extension.assetKinds);
	assert.equal(envelope.manifest.project.schemaFamily, 'lightscaper');
	assert.ok(envelope.manifest.assets.some(asset => asset.kind === PHOTO_CATALOG_PACK_ASSET_KIND));
	const inspected = await f.runtime.inspectScapeProject(f.archive, f.store, { signal: new AbortController().signal }, f.retention);
	assert.equal(inspected.readOnly, true); assert.equal(inspected.reason, 'foreign-family');
	assert.equal(inspected.schemaFamily, 'lightscaper'); assert.equal(inspected.exists, false);
	const opened = await f.runtime.importScapeProject(f.archive, f.store);
	assert.equal(opened.readOnly, true); assert.equal(opened.reason, 'foreign-family'); assert.deepEqual(opened.project, f.document);
	const digest = createHash('sha256');
	const copied = await f.runtime.copyScapeArchive(f.archive, bytes => { digest.update(bytes); });
	assert.equal(copied.schemaFamily, 'lightscaper'); assert.equal(copied.schemaVersion, 1); assert.equal(copied.byteLength, f.archive.size);
	assert.equal(digest.digest('hex'), createHash('sha256').update(new Uint8Array(await f.archive.arrayBuffer())).digest('hex'));
	assert.deepEqual(await f.store.listProjects(), []); assert.deepEqual(await f.store.listSources(), []);
});

test('one intrinsic Light mask registration is harmless but repeated mask or every other intrinsic Photo kind stays a duplicate', OPTIONS, async t => {
	const f = await fixture(t), envelope = await read(f.archive, [MASK]);
	assert.equal(envelope.manifest.project.schemaFamily, 'lightscaper');
	await assert.rejects(read(f.archive, [MASK, MASK]), /duplicate/iu);
	for (const kind of [PHOTO_CATALOG_PACK_ASSET_KIND, PHOTO_STACK_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ASSET_KIND,
		PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND, PHOTO_CUBE_LUT_ASSET_KIND]) {
		await assert.rejects(read(f.archive, [MASK, kind]), /duplicate/iu);
	}
});

function read(archive: Blob, kinds: readonly string[]) {
	return withScapeProjectInput(archive, undefined, entries => readScapeArchiveEnvelope(entries, {}, undefined, kinds));
}
async function fixture(t: TestContext) {
	// The actual producer creates the catalog pack/manifest and hashes every
	// existing tiny Original. This is archive-family evidence, not image decode.
	const exported = await exportPhotoCatalogArchiveV1(stackArchiveRoot(1), [photoArchiveFixture()]);
	assert.ok(exported.blob instanceof Blob);
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	const retained: Promise<unknown>[] = [];
	const retention = Object.freeze({ retain(work: PromiseLike<unknown>) { retained.push(Promise.resolve(work)); } });
	t.after(async () => {
		const jobs = await Promise.allSettled(retained); let failed = false, cleanup: unknown;
		try { await store.close(); } catch (error) { failed = true; cleanup = error; }
		const errors = jobs.flatMap(job => job.status === 'rejected' ? [job.reason as unknown] : []);
		if (failed) errors.push(cleanup);
		if (errors.length) throw new AggregateError(errors, 'Actual opaque Light archive reads/store retirement failed.');
	});
	return { archive: exported.blob, document: exported.document, store, retention, runtime: createFramescaperScapeNativeRuntime(PROFILE) };
}
