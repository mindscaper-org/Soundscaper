/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { digestBytes } from '../src/common/media/bytes.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';

const encoder = new TextEncoder();

async function rewriteArchive(input: Blob, damage: (entries: Map<string, Uint8Array>) => void): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(input));
	const entries = new Map<string, Uint8Array>();
	try {
		for (const entry of await reader.getEntries()) {
			if (!entry.directory) entries.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
		}
	} finally { await reader.close(); }
	damage(entries);
	const writer = new ZipWriter(new BlobWriter(), { level: 0 });
	for (const [name, bytes] of entries) await writer.add(name, new Uint8ArrayReader(bytes));
	return writer.close();
}

for (const damage of ['document', 'audio', 'missing-audio'] as const) {
	test(`normal Scape opening offers and imports a recovered copy after ${damage} damage`, async (context) => {
		const sender = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		context.after(async () => { await sender.close(); await recipient.close(); });
		const sources = ['first', 'second'].map((id) => createAudioSource({ id, frameCount: 2, sampleRate: 48_000, channelCount: 1 }));
		const clips = sources.map((source) => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id, durationFrames: 2 }));
		const project = createSoundscaperProject({ id: 'damaged-archive', title: 'Archive', sources, clips,
			tracks: [createAudioTrack({ id: 'track', clipIds: clips.map(({ id }) => id) })] });
		for (const source of sources) {
			const writer = await sender.beginSourceWrite(source.id, source);
			await writer.write([Float32Array.of(0.25, -0.5)]);
			await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
		}
		const runtime = createSoundscaperScapeNativeRuntime();
		const exported = await runtime.exportScapeProject(project, sender);
		assert.ok(exported.blob);
		const archive = await rewriteArchive(exported.blob, (entries) => {
			if (damage !== 'document') {
				const name = exported.manifest.assets.find(({ sourceId }) => sourceId === 'second')!.entry;
				if (damage === 'missing-audio') entries.delete(name);
				else { const bytes = entries.get(name)!; bytes[bytes.length - 1] ^= 0x20; }
			} else {
				const raw = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { tracks: { gain: number }[] };
				raw.tracks[0]!.gain = -999;
				const bytes = encoder.encode(JSON.stringify(raw));
				entries.set('project.json', bytes);
				const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { project: { size: number; sha256: string } };
				manifest.project.size = bytes.byteLength; manifest.project.sha256 = digestBytes(bytes);
				entries.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
			}
		});
		await recipient.saveProject(project);
		const before = await archive.arrayBuffer();
		if (damage === 'missing-audio') {
			await assert.rejects(runtime.inspectScapeProject(archive, recipient, {
				signal: new AbortController().signal, recover: true, archiveLimits: { maximumEntryCount: 3 },
			}, { retain() {} }), /too many entries/iu);
		}
		const inspected = await runtime.inspectScapeProject(archive, recipient, { signal: new AbortController().signal, recover: true }, { retain() {} });
		assert.ok(inspected.recoveryChanges && inspected.recoveryChanges.length > 0);
		assert.equal(inspected.exists, false);
		assert.notEqual(inspected.id, project.id);
		const result = await runtime.importScapeProject(archive, recipient, { recover: true, collision: 'replace' });
		assert.notEqual(result.project.id, project.id);
		assert.match(result.project.title, /recovered/u);
		assert.equal(result.project.clips.length, damage === 'document' ? 2 : 1);
		assert.equal(result.project.tracks[0]!.gain, 1);
		assert.deepEqual(await recipient.loadProject(project.id), project);
		assert.deepEqual(await archive.arrayBuffer(), before);
	});
}

test('Scape recovery keeps invalid archive integrity closed', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await store.close(); });
	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(createSoundscaperProject({ id: 'integrity' }), store);
	assert.ok(exported.blob);
	const archive = await rewriteArchive(exported.blob, (entries) => {
		const bytes = entries.get('project.json')!; bytes[0] = 0x20;
	});
	await assert.rejects(runtime.importScapeProject(archive, store, { recover: true }), /SHA-256|JSON/iu);
	assert.equal((await store.listProjects()).length, 0);
});

test('recovery preserves future-version read-only custody without publishing a repaired project', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await store.close(); });
	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(createSoundscaperProject({ id: 'future' }), store);
	assert.ok(exported.blob);
	const archive = await rewriteArchive(exported.blob, (entries) => {
		const project = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { schemaVersion: number };
		project.schemaVersion = 99;
		const bytes = encoder.encode(JSON.stringify(project));
		entries.set('project.json', bytes);
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { project: { schemaVersion: number; size: number; sha256: string } };
		Object.assign(manifest.project, { schemaVersion: 99, size: bytes.byteLength, sha256: digestBytes(bytes) });
		entries.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
	});
	const result = await runtime.importScapeProject(archive, store, { recover: true });
	assert.equal(result.readOnly, true);
	assert.equal(result.project.id, 'future');
	assert.equal(result.recoveryChanges, undefined);
	assert.deepEqual(await store.listProjects(), []);
});

for (const damage of ['document', 'timing'] as const) {
	test(`archive recovery preserves video timing authority after ${damage} damage`, async (context) => {
		const sender = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		context.after(async () => { await sender.close(); await recipient.close(); });
		const body = Uint8Array.of(1, 2, 3, 4);
		const contentSha256 = digestBytes(body);
		const timing = createVideoTimingAssetPublication(contentSha256, { timescale: 30_000,
			presentationTicks: [0n], finalFrameDurationTicks: 1_000n });
		const source = createVideoSource({ id: 'camera', width: 16, height: 16, contentSha256, sourceFrameCount: 1,
			sampleFrameCount: 1_600, frameRate: { num: 30, den: 1 }, timingAsset: timing.reference });
		const project = createSoundscaperProject({ id: 'timed-video', sources: [source], primarySequenceId: 'main',
			sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['audio', 'picture'] }],
			tracks: [createAudioTrack({ id: 'audio' }), { id: 'picture', type: 'video', clipIds: ['video'] }],
			clips: [{ kind: 'video', id: 'video', sourceId: source.id, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1 }] });
		await sender.writeMediaAsset(source.storageKey, new Blob([body]), { kind: 'video' });
		await sender.writeMediaAsset(timing.reference.storageKey, new Blob([Uint8Array.from(timing.bytes)]), { kind: 'video-timing' });
		const runtime = createSoundscaperScapeNativeRuntime();
		const exported = await runtime.exportScapeProject(project, sender);
		assert.ok(exported.blob);
		const archive = await rewriteArchive(exported.blob, (entries) => {
			const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as {
				project: { size: number; sha256: string }; assets: { kind: string; entry: string }[];
			};
			if (damage === 'timing') {
				const bytes = entries.get(manifest.assets.find(({ kind }) => kind === 'video-timing')!.entry)!;
				bytes[bytes.length - 1] ^= 0x20;
			} else {
				const raw = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { tracks: { gain: number }[] };
				raw.tracks[0]!.gain = -999;
				const bytes = encoder.encode(JSON.stringify(raw)); entries.set('project.json', bytes);
				Object.assign(manifest.project, { size: bytes.byteLength, sha256: digestBytes(bytes) });
				entries.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
			}
		});
		const result = await runtime.importScapeProject(archive, recipient, { recover: true });
		assert.equal(result.project.sources.length, damage === 'document' ? 1 : 0);
		if (damage === 'document') assert.ok(await recipient.loadMediaAsset(timing.reference.storageKey));
	});
}
