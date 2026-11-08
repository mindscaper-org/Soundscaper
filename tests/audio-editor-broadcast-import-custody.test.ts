/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { readRiffChunks } from './helpers/read-riff-chunks.ts';
import { readWavePcm } from './helpers/read-wave-pcm.ts';

// Browser witnesses cover real rendering and download wiring. Here each input
// independently enters the controller, a portable archive and the delivery plan.
for (const namespace of ['cart', 'ixml', 'both']) test(`${namespace} broadcast metadata survives import, Scape reopen and BWF planning`, async context => {
	const hasCart = namespace !== 'ixml', hasIxml = namespace !== 'cart';
	const pcm = new Float32Array(48_000).fill(.125);
	const file = new File([Uint8Array.from(encodeWav([pcm], {
		sampleRate: 48_000, bitDepth: 16, dither: false, bext: { description: 'Recorder description' },
		...(hasCart ? { cart: { title: 'Radio continuity take', postTimers: [{ usage: 'SEC1', value: 24_000 }] } } : {}),
		...(hasIxml ? { ixml: { project: 'Radio series', scene: 'Studio A', take: '12', note: 'Keep the complete take.' } } : {}),
	}))], `studio-take-${namespace}.wav`, { type: 'audio/wav' });
	const project = await importedAndReopened(context, file, [new Float32Array(48_000).fill(.125)]);
	assert.equal(project.metadata.bext?.description, 'Recorder description');
	assert.equal(Boolean(project.metadata.cart), hasCart); assert.equal(Boolean(project.metadata.ixml), hasIxml);
	const plan = createExportPlan(project, { format: 'bwf', sampleRate: 48_000, bitDepth: 16 });
	assert.equal(plan.bext?.description, 'Recorder description');
	assert.equal(Boolean(plan.cart), hasCart); assert.equal(Boolean(plan.ixml), hasIxml);
	if (hasCart) {
		assert.equal(project.metadata.cart?.title, 'Radio continuity take');
		assert.deepEqual(project.metadata.cart?.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
		assert.equal(plan.cart?.title, 'Radio continuity take');
		assert.deepEqual(plan.cart?.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
	}
	if (hasIxml) {
		for (const xml of [project.metadata.ixml?.rawXml, plan.ixml?.rawXml]) {
			assert.ok(typeof xml === 'string');
			assert.match(xml, /<PROJECT>Radio series<\/PROJECT>/u);
			assert.match(xml, /<SCENE>Studio A<\/SCENE>/u); assert.match(xml, /<TAKE>12<\/TAKE>/u);
			assert.match(xml, /<NOTE>Keep the complete take\.<\/NOTE>/u);
		}
	}
});

const recording = Buffer.from((await readFile(new URL('./fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8')).trim(), 'base64');
const expectedXml = new TextDecoder().decode(readRiffChunks(recording).get('iXML'));
const expectedPcm = readWavePcm(recording);

for (const extension of ['wav', 'bwf', 'BWF']) for (const mimeType of ['', 'application/octet-stream', 'audio/wav']) {
	test(`recorder ${extension} with ${mimeType || 'unassigned'} MIME retains its BEXT, complete XML and PCM through Scape reopen and BWF planning`, async context => {
		const file = new File([recording], `production-take.${extension}`, { type: mimeType });
		const project = await importedAndReopened(context, file, expectedPcm.channels);
		assert.equal(project.metadata.bext?.description, 'Production boom take');
		assert.equal(project.metadata.ixml?.rawXml, expectedXml);
		assert.equal(project.metadata.cart ?? null, null);
		const plan = createExportPlan(project, { format: 'bwf', sampleRate: 48_000, bitDepth: 16 });
		assert.equal(plan.sampleRate, 48_000);
		assert.equal(plan.bext?.description, 'Production boom take');
		assert.equal(plan.ixml?.rawXml, expectedXml);
		assert.equal(plan.cart ?? null, null);
	});
}

async function importedAndReopened(context: TestContext, file: File, expectedPcm: Float32Array[]): Promise<SoundscaperProject> {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const sender = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store: sender,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); await recipient.close(); });
	await controller.ready;
	await controller.actions.project.importFiles([file]);
	const imported: unknown = controller.project; assert.ok(validateSoundscaperProject(imported));
	assert.equal(imported.clips.length, 1); assert.equal(imported.sources.length, 1);
	const archive = createSoundscaperScapeNativeRuntime();
	const exported = await archive.exportScapeProject(imported, sender); assert.ok(exported.blob);
	const reopened = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false);
	const project: unknown = reopened.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.sampleRate, 48_000); assert.equal(source.frameCount, 48_000); assert.equal(source.channelCount, 1);
	const origin = normalizeSourceProvenance(source.provenance).contributions[0]?.origin;
	assert.ok(origin?.kind === 'local-file'); assert.equal(origin.originalFileName, file.name); assert.equal(origin.byteLength, file.size);
	const pcm: number[] = [];
	for await (const chunk of recipient.readSourceChunks(source.storageKey)) {
		assert.ok(chunk.channels[0]); pcm.push(...chunk.channels[0]);
	}
	assertPcmChannelsEqual([Float32Array.from(pcm)], expectedPcm);
	return project;
}
