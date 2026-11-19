/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import type { AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import { createEditorProjectRuntimeSelection } from '../../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createFramescaperProjectFeatureCompatibilityService } from '../../src/framescaper/editor-project-feature-requirements.ts';
import { validateFramescaperProject, type FramescaperProject } from '../../src/framescaper/editor-project.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { assertPcmSamplesEqual } from './assert-pcm-samples.ts';
import { readCustodyPcm } from './audio-project-archive-pcm-custody.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export interface CompatibilityPcmInput {
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly frequency: number;
	readonly amplitudes: readonly [number, number];
}

function productStore() {
	return createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
}

/** The original browser publishers import only these WAVs; native playback remains in their recipients. */
export async function createFramescaperCompatibilityArchive(files: readonly CompatibilityPcmInput[]) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createEditorProjectRuntimeSelection(PROFILE), store = productStore();
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const engine = { ...createMemoryEngine(), async decodeAudioData() { throw new Error('WAV fixture custody requires the real PCM decoder.'); } };
	const ffmpeg = { ...createMemoryFfmpeg(), async decode() { throw new Error('WAV fixture custody must not substitute decoded PCM.'); },
		async encode() { throw new Error('WAV fixture custody must not substitute encoded PCM.'); } };
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: archive,
		engine: engine as unknown as Options['engine'], ffmpeg: ffmpeg as unknown as Options['ffmpeg'],
		engineFactory: () => { throw new Error('Publisher source custody must not use a render substitute.'); } });
	try {
		await controller.ready;
		await controller.actions.project.importFiles(files.map(file => new File([Uint8Array.from(file.bytes)], file.name, { type: 'audio/wav' })));
		await controller.actions.project.flush();
		const project: unknown = controller.project; assert.ok(validateFramescaperProject(PROFILE, project));
		assert.deepEqual(await store.loadProject(project.id), project);
		await assertSourcePcm(store, project, files);
		const exported = await archive.exportScapeProject(project, store); assert.ok(exported.blob);
		const bytes = new Uint8Array(await exported.blob.arrayBuffer());
		const reopened = await qualifyFramescaperCompatibilityArchive(bytes, files);
		assert.deepEqual(reopened, project);
		return { projectId: project.id, bytes };
	} finally { try { await controller.dispose(); } finally { await store.close(); } }
}

/** Authenticate the exact bytes that will be given to the browser's native Scape importer. */
export async function qualifyFramescaperCompatibilityArchive(bytes: Uint8Array, files: readonly CompatibilityPcmInput[]): Promise<FramescaperProject> {
	const entries = unzipSync(bytes), projectBytes = entries['project.json']; assert.ok(projectBytes);
	const project: unknown = JSON.parse(strFromU8(projectBytes)); assert.ok(validateFramescaperProject(PROFILE, project));
	const manifestBytes = entries['manifest.json']; assert.ok(manifestBytes);
	const manifest = record(JSON.parse(strFromU8(manifestBytes)) as unknown);
	const document = record(manifest.project);
	assert.equal(document.schemaFamily, 'framescaper'); assert.equal(document.schemaVersion, 1);
	assert.equal(document.size, projectBytes.length); assert.equal(document.sha256, digest(projectBytes), 'project digest');
	assert.ok(Array.isArray(manifest.assets)); assert.equal(manifest.assets.length, files.length);
	for (const value of manifest.assets) {
		const asset = record(value); assert.equal(asset.kind, 'audio'); assert.ok(typeof asset.entry === 'string');
		const payload = entries[asset.entry]; assert.ok(payload);
		assert.equal(asset.size, payload.length); assert.equal(asset.sha256, digest(payload), 'audio asset digest');
		assert.ok(project.sources.some(source => source.id === asset.sourceId));
	}
	const recipient = productStore();
	try {
		const restored = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(new Blob([Uint8Array.from(bytes)]), recipient);
		assert.equal(restored.readOnly, false);
		const reopened: unknown = restored.project; assert.ok(validateFramescaperProject(PROFILE, reopened));
		assert.deepEqual(reopened, project); assert.deepEqual(await recipient.loadProject(project.id), project);
		await assertSourcePcm(recipient, reopened, files);
		return reopened;
	} finally { await recipient.close(); }
}

async function assertSourcePcm(store: AudioEditorProjectStore, project: FramescaperProject, files: readonly CompatibilityPcmInput[]): Promise<void> {
	assert.equal(project.sampleRate, 48_000); assert.equal(project.sources.length, files.length); assert.equal(project.clips.length, files.length);
	assert.deepEqual(project.featureRequirements, { schemaVersion: 2, requirements: [
		{ id: 'framescaper.video-color-management', featureId: 'org.soundscaper.capability.video-color-management', displayName: 'Managed video color', disposition: 'bypass', fallback: null },
		{ id: 'framescaper.audio-mixer-graph', featureId: 'org.soundscaper.capability.audio-mixer-graph', displayName: 'Audio mixer graph', disposition: 'bypass', fallback: null },
	] }, 'plain WAV publication must retain its exact native Framescaper baseline requirements');
	assert.equal(createFramescaperProjectFeatureCompatibilityService(PROFILE).evaluate(project)?.compatible, true);
	for (const file of files) {
		const source = project.sources.find(candidate => candidate.name === file.name); assert.ok(source?.kind === 'audio');
		assert.equal(source.sampleRate, 48_000, 'fixture source sampleRate'); assert.equal(source.frameCount, 38_400); assert.equal(source.channelCount, 2);
		const clip = project.clips.find(candidate => candidate.sourceId === source.id); assert.ok(clip?.kind === 'audio');
		assert.equal(clip.durationFrames, 38_400); assert.equal(clip.sourceDurationFrames, 38_400);
		const channels = await readCustodyPcm(store, source); assert.equal(channels.length, 2);
		for (const [index, channel] of channels.entries()) {
			const expected = Float32Array.from({ length: 38_400 }, (_value, frame) => {
				const sine = Math.sin(2 * Math.PI * file.frequency * frame / 48_000 + (index ? Math.PI / 3 : 0));
				return (Math.round(sine * file.amplitudes[index]! * 32_767) || 0) / 32_768;
			});
			assertPcmSamplesEqual(channel, expected, `${file.name} channel ${index}`);
		}
	}
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
