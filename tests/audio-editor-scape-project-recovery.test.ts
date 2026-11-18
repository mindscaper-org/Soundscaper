/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { digestBytes } from '../src/common/media/bytes.ts';
import type { ProjectRecoveryChange } from '../src/common/editor/project-recovery-reason.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore, createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime, type SoundscaperScapeNativeStore } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { readTrackPlaylists } from '../src/common/editor/track-playlists.ts';
import { readSessionSnapshots } from '../src/common/editor/session-snapshots.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

const encoder = new TextEncoder();
type ControllerOptions = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

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

for (const decision of ['collision', 'recovery'] as const) {
	test(`saving a ${decision} copy of a selected Scape prompts for a new file`, async context => {
		const folder = await mkdtemp(join(tmpdir(), 'scape-copy-original-'));
		const sender = createSoundscaperEphemeralProjectStore(), recipient = createSoundscaperEphemeralProjectStore();
		context.after(async () => { await sender.close(); await rm(folder, { recursive: true, force: true }); });
		const source = createAudioSource({ id: 'voice', frameCount: 2, sampleRate: 48_000, channelCount: 1 });
		const clip = createAudioClip({ id: 'spoken', sourceId: source.id, durationFrames: 2 });
		const project = createSoundscaperProject({ id: 'original', sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'dialogue', clipIds: [clip.id] })] });
		const writer = await sender.beginSourceWrite(source.id, source);
		await writer.write([Float32Array.of(.25, -.5)]);
		await writer.commit();
		const scapeProjectRuntime = createSoundscaperScapeNativeRuntime();
		const exported = await scapeProjectRuntime.exportScapeProject(project, sender);
		assert.ok(exported.blob);
		const archive = decision === 'collision' ? exported.blob : await rewriteArchive(exported.blob, entries => {
			const audio = exported.manifest.assets.find(asset => asset.sourceId === source.id);
			assert.ok(audio);
			entries.delete(audio.entry);
		});
		const original = { id: 'a'.repeat(48), name: 'original.sscape' };
		const path = join(folder, original.name), destination = join(folder, 'exported-copy.sscape');
		const bytes = Buffer.from(await archive.arrayBuffer());
		await writeFile(path, bytes);
		const file = new File([await readFile(path)], original.name);
		registerDesktopOriginalFile(file, original);
		let overwrites = 0, newDestinations = 0;
		const targets = new SaveTargetStore(), owner = {};
		const saves = new AtomicSaveManager({ targets } as never);
		context.after(async () => { await saves.dispose(); });
		const targetFor = (filePath: string) => targets.registerPath(filePath, { owner, purpose: 'project' });
		const fileService = createAudioEditorFileService({ bridge: {
			prepareOriginalOverwrite: async () => { overwrites++; return targetFor(path); },
			chooseSaveTarget: async () => { newDestinations++; return targetFor(destination); },
			beginWrite: (request: { targetId: string; maximumSize?: number; size?: number }) => saves.begin({ ...request, owner }),
			writeChunk: (request: { writeId: string; offset: number; bytes: Uint8Array }) => saves.writeChunk({ ...request, owner }),
			finishWrite: (writeId: string) => saves.finish(writeId, { owner }),
			abortWrite: (writeId: string) => saves.abort(writeId, { owner }),
		} });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en',
			copy: COPY, store: recipient, projectRuntime: runtime, sessionController: runtime.createSessionController(),
			fileService, scapeProjectRuntime, engine: createMemoryEngine() as unknown as ControllerOptions['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as ControllerOptions['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		if (decision === 'collision') await recipient.saveProject(createSoundscaperProject({ id: project.id, title: 'Other working copy' }));
		const opened = await controller.actions.project.openScapeFile(file, request => {
			assert.equal(request.kind, decision);
			return 'copy';
		});
		assert.ok(typeof opened === 'object' && opened !== null && 'project' in opened);
		assert.notEqual(controller.project?.id, project.id);
		assert.equal(await controller.actions.project.saveFile(), true);
		assert.equal(newDestinations, 1);
		assert.equal(overwrites, 0);
		assert.deepEqual(await readFile(path), bytes);
		const checked = await scapeProjectRuntime.inspectScapeProject(new Blob([await readFile(destination)]), recipient,
			{ signal: new AbortController().signal }, { retain() {} });
		assert.equal(checked.id, controller.project?.id);
	});
}

for (const damage of ['document', 'audio', 'missing-audio', 'pcm-geometry'] as const) {
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
				else if (damage === 'pcm-geometry') {
					const bytes = entries.get(name)!;
					new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 1, true);
					const digest = digestBytes(bytes);
					const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as {
						project: { size: number; sha256: string }; assets: { entry: string; sha256: string }[];
					};
					manifest.assets.find(asset => asset.entry === name)!.sha256 = digest;
					const raw = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as {
						sources: { id: string; contentSha256?: string }[];
					};
					const damaged = raw.sources.find(({ id }) => id === 'second')!;
					if (damaged.contentSha256 !== undefined) damaged.contentSha256 = digest;
					const projectBytes = encoder.encode(JSON.stringify(raw));
					Object.assign(manifest.project, { size: projectBytes.byteLength, sha256: digestBytes(projectBytes) });
					entries.set('project.json', projectBytes);
					entries.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
				} else { const bytes = entries.get(name)!; bytes[bytes.length - 1] ^= 0x20; }
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

test('Open Scape recovery retains healthy arrangements on a track with one unavailable playlist', async context => {
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await store.close(); });
	const sources = ['dialogue', 'music'].map(id => createAudioSource({ id, sampleRate: 48000, channelCount: 1, frameCount: 2 }));
	for (const source of sources) {
		const writer = await store.beginSourceWrite(source.id, source);
		await writer.write([Float32Array.of(0.125, -0.25)]);
		await writer.commit();
	}
	const trackId = 'track';
	let project = createSoundscaperProject({ id: 'playlists', sources,
		tracks: [createAudioTrack({ id: trackId, clipIds: ['spoken'] })],
		clips: [createAudioClip({ id: 'spoken', sourceId: 'dialogue', durationFrames: 2 })] });
	const createPlaylist = { type: 'track/playlist-create', trackId, mode: 'empty', originalId: 'original', originalName: 'Original' } as const;
	project = applySoundscaperProjectCommand(project, { ...createPlaylist, id: 'music', name: 'Music alternative' });
	project = applySoundscaperProjectCommand(project, { type: 'clip/add', trackId, clip: createAudioClip({ id: 'bed', sourceId: 'music', durationFrames: 2 }) });
	project = applySoundscaperProjectCommand(project, { ...createPlaylist, id: 'active', name: 'Current edit' });
	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(project, store);
	assert.ok(exported.blob);
	const archive = await rewriteArchive(exported.blob, entries => {
		entries.delete(exported.manifest.assets.find(asset => asset.sourceId === 'music')!.entry);
	});
	const result = await runtime.importScapeProject(archive, store, { recover: true });
	assert.equal(readTrackPlaylists(result.project)[0]?.activeId, 'active');
	assert.deepEqual(readTrackPlaylists(result.project)[0]?.playlists.map(entry => entry.id), ['original', 'active']);
	const recalled = applySoundscaperProjectCommand(result.project, { type: 'track/playlist-activate', trackId, id: 'original' });
	assert.equal(recalled.clips[0]?.id, 'spoken');
	assert.ok(result.recoveryChanges?.some((change: ProjectRecoveryChange) => change.path === 'metadata.trackPlaylists[0].playlists[1]'));
});

test('Open Scape recovery retires extension assets owned only by a discarded snapshot', async context => {
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await store.close(); });
	const sources = ['unavailable', 'surviving'].map(id => createAudioSource({ id, sampleRate: 48000, channelCount: 1, frameCount: 2 }));
	for (const source of sources) {
		const writer = await store.beginSourceWrite(source.id, source);
		await writer.write([Float32Array.of(0.125, -0.25)]);
		await writer.commit();
	}
	const bytes = Uint8Array.of(1, 7, 255), sha256 = digestBytes(bytes), bodyId = `native-plugin-state:${sha256}`;
	const native: SoundscaperScapeNativeStore = {
		getNativePluginStateBodyMetadata: (id: string) => id === bodyId ? { byteLength: bytes.byteLength, sha256 } : null,
		loadNativePluginStateBody: (id: string) => id === bodyId ? bytes : null,
	};
	const sender = new Proxy(store as typeof store & SoundscaperScapeNativeStore, { get(target, key) {
		const owner = Object.hasOwn(native, key) ? native : target;
		const value: unknown = Reflect.get(owner, key, owner);
		return typeof value === 'function' ? value.bind(owner) : value;
	} });
	const trackId = 'track';
	let project = createSoundscaperProject({ id: 'snapshot-bodies', sources,
		tracks: [createAudioTrack({ id: trackId, clipIds: ['lost-clip', 'healthy-clip'] })],
		clips: [createAudioClip({ id: 'lost-clip', sourceId: 'unavailable', durationFrames: 2 }),
			createAudioClip({ id: 'healthy-clip', sourceId: 'surviving', durationFrames: 2, timelineStartFrame: 2 })],
		nativePluginStates: [{ instanceId: 'plugin', format: 'vst3', stablePluginId: 'test.plugin', binarySha256: 'ab'.repeat(32),
			stateBody: { kind: 'native-plugin-state', bodyId, sha256, byteLength: bytes.byteLength },
			enabled: true, bypassed: false, continuity: 'live', latencySamples: 0 }],
	});
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'snapshot', name: 'Original mix', createdAt: '2026-11-17T10:00:00Z' });
	project = applySoundscaperProjectCommand(project, { type: 'native-plugin-state/remove', instanceId: 'plugin' });
	project = applySoundscaperProjectCommand(project, { type: 'clip/remove', clipId: 'lost-clip' });
	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(project, sender);
	assert.ok(exported.blob);
	assert.ok(exported.manifest.assets.some(asset => asset.sourceId === bodyId));
	const archive = await rewriteArchive(exported.blob, entries => {
		entries.delete(exported.manifest.assets.find(asset => asset.sourceId === 'unavailable')!.entry);
	});
	const recovered = await runtime.importScapeProject(archive, store, { recover: true });
	const document: unknown = recovered.project;
	assert.ok(validateSoundscaperProject(document));
	assert.deepEqual(readSessionSnapshots(document), []);
	assert.deepEqual(document.clips.map(clip => clip.id), ['healthy-clip']);
	assert.ok(recovered.recoveryChanges?.some((change: ProjectRecoveryChange) => change.path === 'metadata.sessionSnapshots[0]'));
});

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
