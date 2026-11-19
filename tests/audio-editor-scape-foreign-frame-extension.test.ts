/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { withScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-catalog-pack.ts';
import { PHOTO_STACK_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-smart-collection-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-develop-preset-pack.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND } from '../src/common/editor/scape-photo-cube-lut.ts';
import { PHOTO_MASK_RASTER_ASSET_KIND_V1 } from '../src/common/editor/scape-photo-mask-raster-v1.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createFramescaperScapeProjectAssetExtension } from '../src/framescaper/editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { rewriteScapeManifest } from './helpers/scape-archive-rewrite.js';

const OPTIONS = { timeout: 15_000 }, SOURCE = 'foreign-audio', NOW = '2026-10-20T12:00:00.000Z';
const FRAME_EXTENSION = createFramescaperScapeProjectAssetExtension(PROFILE);
const PHOTO_KINDS = [PHOTO_CATALOG_PACK_ASSET_KIND, PHOTO_STACK_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ASSET_KIND,
	PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND, PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_MASK_RASTER_ASSET_KIND_V1] as const;

test('actual Frame runtime opens ordinary Sound PCM opaquely and saves its exact unchanged archive despite the registered mask extension', OPTIONS, async t => {
	const f = await fixture(t, true);
	assert.ok(FRAME_EXTENSION.assetKinds.includes(PHOTO_MASK_RASTER_ASSET_KIND_V1));
	const envelope = await readEnvelope(f.archive, FRAME_EXTENSION.assetKinds);
	assert.deepEqual(envelope.manifest.assets.map(asset => asset.kind), ['audio']);
	const inspection = await f.frame.inspectScapeProject(f.archive, f.destination, { signal: new AbortController().signal }, f.retention);
	assert.equal(inspection.schemaFamily, 'soundscaper'); assert.equal(inspection.schemaVersion, 1);
	assert.equal(inspection.readOnly, true); assert.equal(inspection.reason, 'foreign-family'); assert.equal(inspection.exists, false);
	const opened = await f.frame.importScapeProject(f.archive, f.destination);
	assert.equal(opened.readOnly, true); assert.equal(opened.reason, 'foreign-family'); assert.deepEqual(opened.project, f.project);
	const chunks: Uint8Array[] = [];
	const copied = await f.frame.copyScapeArchive(f.archive, bytes => { chunks.push(bytes); });
	const output = new Uint8Array(copied.byteLength); let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	assert.equal(copied.schemaFamily, 'soundscaper'); assert.equal(copied.schemaVersion, 1); assert.equal(offset, f.archive.size);
	assert.equal(hash(output), hash(new Uint8Array(await f.archive.arrayBuffer())));
	assert.equal(await f.destination.loadProject(f.project.id), null); assert.deepEqual(await f.destination.listSources(), []);
	assert.deepEqual(await f.source.getSourceMetadata(SOURCE), f.sourceMetadata);
});

test('actual empty Sound archive also remains an unchanged opaque Frame open without any Photo asset', OPTIONS, async t => {
	const f = await fixture(t, false), envelope = await readEnvelope(f.archive, FRAME_EXTENSION.assetKinds);
	assert.deepEqual(envelope.manifest.assets, []);
	const opened = await f.frame.importScapeProject(f.archive, f.destination); assert.equal(opened.readOnly, true);
	assert.equal(opened.reason, 'foreign-family'); assert.deepEqual(opened.project, f.project);
	const digest = createHash('sha256');
	const copied = await f.frame.copyScapeArchive(f.archive, bytes => { digest.update(bytes); });
	assert.equal(copied.byteLength, f.archive.size); assert.equal(digest.digest('hex'), hash(new Uint8Array(await f.archive.arrayBuffer())));
	assert.deepEqual(await f.destination.listProjects(), []); assert.deepEqual(await f.destination.listSources(), []);
});

test('real Sound archives with actual reserved Photo descriptors remain refused before import or unchanged-copy output', OPTIONS, async t => {
	const f = await fixture(t, true);
	for (const kind of PHOTO_KINDS) {
		const wrongFamily = await rewriteScapeManifest(f.archive, (manifest: { assets: Array<{ kind: string }> }) => {
			const asset = manifest.assets[0]; assert.ok(asset); asset.kind = kind;
		});
		await assert.rejects(readEnvelope(wrongFamily, FRAME_EXTENSION.assetKinds), /invalid kind|registered project family/iu, kind);
		await assert.rejects(f.frame.inspectScapeProject(wrongFamily, f.destination,
			{ signal: new AbortController().signal }, f.retention), /invalid kind|registered project family/iu, kind);
		await assert.rejects(f.frame.importScapeProject(wrongFamily, f.destination), /invalid kind|registered project family/iu, kind);
		let emitted = 0;
		await assert.rejects(f.frame.copyScapeArchive(wrongFamily, bytes => { emitted += bytes.byteLength; }), /invalid kind|registered project family/iu, kind);
		assert.equal(emitted, 0); assert.deepEqual(await f.destination.listProjects(), []); assert.deepEqual(await f.destination.listSources(), []);
	}
});

test('ignored foreign mask registration cannot bypass duplicate, malformed or other reserved-kind registration checks', OPTIONS, async t => {
	const f = await fixture(t, true), mask = PHOTO_MASK_RASTER_ASSET_KIND_V1;
	await assert.rejects(readEnvelope(f.archive, [mask, mask]), /duplicate/iu);
	await assert.rejects(readEnvelope(f.archive, [mask, 'Invalid kind']), /additional.*invalid/iu);
	for (const kind of PHOTO_KINDS.filter(kind => kind !== mask)) {
		await assert.rejects(readEnvelope(f.archive, [kind]), /registered project family/iu);
	}
	await assert.rejects(readEnvelope(f.archive, ['audio']), /duplicate/iu);
});

async function readEnvelope(archive: Blob, kinds: readonly string[]) {
	return await withScapeProjectInput(archive, undefined, entries => readScapeArchiveEnvelope(entries, {}, undefined, kinds));
}
async function fixture(t: TestContext, withAudio: boolean) {
	const suffix = randomUUID();
	const source = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `foreign-frame-source-${suffix}` });
	const destination = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	const retained: Promise<unknown>[] = [];
	const retention = Object.freeze({ retain(settlement: PromiseLike<unknown>) { retained.push(Promise.resolve(settlement)); } });
	t.after(async () => {
		const work = await Promise.allSettled(retained);
		const settled = await Promise.allSettled([source.close(), destination.close()]);
		const errors = [...work, ...settled].flatMap(item => item.status === 'rejected' ? [item.reason as unknown] : []);
		if (errors.length) throw new AggregateError(errors, 'Actual foreign archive store retirement failed.');
	});
	if (withAudio) {
		const writer = await source.beginSourceWrite(SOURCE, { name: 'ordinary.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1 });
		try { await writer.write([Float32Array.of(0.25, -0.5, 0.75, 0)]); await writer.commit(); }
		catch (error) {
			const cleanup: unknown[] = [];
			try { await writer.abort(); } catch (failure) { cleanup.push(failure); }
			const distinct = cleanup.filter(failure => !Object.is(error, failure));
			if (distinct.length) throw new AggregateError([error, ...distinct], 'Actual PCM write and retirement failed.', { cause: error });
			throw error;
		}
	}
	const project = createSoundscaperProject({ id: `foreign-sound-${suffix}`, title: 'Actual ordinary Sound archive', now: NOW,
		sources: withAudio ? [createAudioSource({ id: SOURCE, storageKey: SOURCE, name: 'ordinary.wav', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000 })] : [],
		clips: withAudio ? [createAudioClip({ id: 'audio-clip', sourceId: SOURCE, timelineStartFrame: 0, durationFrames: 4 })] : [],
		tracks: withAudio ? [createAudioTrack({ id: 'audio-track', name: 'Ordinary PCM', clipIds: ['audio-clip'] })] : [],
	});
	const exported = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, source);
	assert.ok(exported.blob instanceof Blob); assert.ok(exported.manifest);
	assert.equal(exported.manifest.project.schemaFamily, 'soundscaper');
	return { project, archive: exported.blob, source, sourceMetadata: withAudio ? await source.getSourceMetadata(SOURCE) : null,
		destination, retention, frame: createFramescaperScapeNativeRuntime(PROFILE) };
}
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
