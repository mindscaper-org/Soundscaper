/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { projectAudioMetadata } from '../src/common/editor/id3-descriptive-fields.ts';
import { normalizeMediaMetadata } from '../src/common/editor/media-metadata.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const key of ['XSourceMedium', 'ALBUM ARTIST', 'SOURCE MEDIUM']) test(`native custom metadata remains exportable: ${key}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	// Pinned native TagsEditor accepts custom ASCII names and Tags::WriteXML emits them unchanged.
	const xml = (await projectFile.text()).replace('<wavetrack', `<tags><tag name="${key}" value="Analogue tape"/></tags>\n<wavetrack`);
	await controller.actions.project.importFiles([new File([xml], projectFile.name, { type: projectFile.type }), dataFile]);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	const nativeKey = key.toUpperCase();
	assert.equal(project.metadata.tags[nativeKey], 'Analogue tape');
	const receiver = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	context.after(async () => { await receiver.close(); });
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store); assert.ok(archive.blob);
	const reopened = await createSoundscaperScapeNativeRuntime().importScapeProject(archive.blob, receiver);
	const restored: unknown = reopened.project; assert.ok(validateSoundscaperProject(restored));
	assert.equal(restored.metadata.tags[nativeKey], 'Analogue tape');
	assert.equal(restored.sources.length, 1);
	const source = restored.sources[0]; assert.ok(source?.kind === 'audio');
	const pcm = await readPcm(receiver, source.storageKey);
	const expected = Float32Array.from({ length: 4800 }, (_, frame) => frame % 2 ? -.25 : .25);
	assert.equal(pcm.length, 1); assertPcmSamplesEqual(Float32Array.from(pcm[0]!), expected);
	const settings = createExportDialogInitialSettings(restored);
	const request = createExportDialogRequest(settings, { metadata: projectAudioMetadata(restored.metadata) });
	const plan = createExportPlan(restored, request);
	assert.equal(plan.metadata[key === 'ALBUM ARTIST' ? 'albumArtist' : nativeKey], 'Analogue tape');
	const bytes = Uint8Array.from(encodeWav([Float32Array.from(pcm[0]!)], { sampleRate: 48_000, bitDepth: 16, dither: false, metadata: plan.metadata }));
	const descriptor = await inspectWavBlobPcm(new Blob([bytes])); assert.ok(descriptor);
	assert.deepEqual([descriptor.sampleRate, descriptor.frameCount, descriptor.channelCount], [48_000, 4800, 1]);
	const samples = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let frame = 0; frame < expected.length; frame++) {
		assert.equal(samples.getInt16(descriptor.dataOffset + frame * 2, true) / 32768, expected[frame]);
	}
	const read = await inspectImportedMediaMetadata(new File([bytes.buffer], 'Delivered.wav'));
	if (key === 'ALBUM ARTIST') assert.equal(read.metadata.raw?.TPE2, 'Analogue tape');
	else assert.deepEqual(read.metadata.raw?.TXXX, { [nativeKey]: 'Analogue tape' });
	assert.equal(project.metadata.tags[nativeKey], 'Analogue tape');
	const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
	assert.equal(saved.metadata.tags[nativeKey], 'Analogue tape');
});

test('ASCII spaces preserve custom names while existing metadata limits and refusal grammar remain', () => {
	assert.deepEqual(normalizeMediaMetadata({ 'SOURCE MEDIUM': 'Analogue tape' }), { 'SOURCE MEDIUM': 'Analogue tape' });
	for (const key of ['bad=key', 'bad/key', 'bad:key', 'bad\nkey', 'bad\tkey', 'bad\0key', 'étiquette', 'x'.repeat(65), '   ']) {
		assert.throws(() => normalizeMediaMetadata({ [key]: 'Value' }), /Invalid metadata field name/u);
	}
	assert.throws(() => normalizeMediaMetadata({ 'SOURCE MEDIUM': 'bad\0value' }), /control characters/u);
	assert.throws(() => normalizeMediaMetadata({ 'SOURCE MEDIUM': 'x'.repeat(4097) }), /too long/u);
	assert.throws(() => normalizeMediaMetadata(Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`Key ${index}`, 'v']))), /at most 128/u);
});

test('custom-name compatibility keeps reserved JSON keys as inert own data', () => {
	const normalized = normalizeMediaMetadata(Object.fromEntries([['__proto__', 'Credit'], ['SOURCE MEDIUM', 'Tape']]));
	assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
	assert.equal(Object.hasOwn(normalized, '__proto__'), true);
	assert.equal(normalized.__proto__, 'Credit');
	assert.equal(normalized['SOURCE MEDIUM'], 'Tape');
});
