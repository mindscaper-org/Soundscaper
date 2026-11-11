/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { parseIxmlPayload } from '../src/common/editor/ixml.ts';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import { createOriginalOverwriteActions, isOriginalOverwriteSettings } from '../src/common/editor/controller/export/internal/overwrite-original-action.ts';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createDesktopOriginalImportRecorder, resetDesktopOriginal } from '../src/common/editor/desktop-overwrite-original.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createFixture } from './helpers/export-service-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { readRiffChunks } from './helpers/read-riff-chunks.ts';
import { readWavePcm } from './helpers/read-wave-pcm.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

const warning = 'delivery.ixml-file-uid-omitted';
async function recorderProject() {
	// BWF MetaEdit26.08.1 embeds physical FILE_UID and shared FAMILY_UID into stereo PCM.
	const encoded = await readFile(new URL('./fixtures/bwfmetaedit-file-uid.wav.base64', import.meta.url), 'utf8');
	const input = new File([Buffer.from(encoded.trim(), 'base64')], 'Recorder.wav', { type: 'audio/wav' });
	const info = await inspectWavBlobPcm(input); assert.ok(info.ixml);
	return createSoundscaperProject({ sampleRate: 48_000, masterChannels: 2,
		sources: [{ id: 'source', name: input.name, channelCount: 2, frameCount: 4800, sampleRate: 48_000, sampleFormat: 'float32', storageKey: 'source' }],
		clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0, timelineStartFrame: 0, durationFrames: 4800 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Recorder', clipIds: ['clip'] }], metadata: { ixml: info.ixml } });
}

test('actual recorder import retains physical FILE_UID and stereo PCM through product stores and fresh Scape', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const bytes = Buffer.from((await readFile(new URL('./fixtures/bwfmetaedit-file-uid.wav.base64', import.meta.url), 'utf8')).trim(), 'base64');
	const xml = readRiffChunks(bytes).get('iXML'); assert.ok(xml);
	const expectedXml = new TextDecoder().decode(xml);
	assert.ok(expectedXml.includes('<FILE_UID>RECORDER-FILE-UNIQUE-0001</FILE_UID>'));
	assert.ok(expectedXml.includes('<FAMILY_UID>TAKE-FAMILY-0001</FAMILY_UID>'));
	const expected = readWavePcm(bytes);
	assert.equal(expected.sampleRate, 48_000); assert.equal(expected.channels.length, 2);
	for (const channel of expected.channels) assert.equal(channel.length, 4800);
	const file = new File([Uint8Array.from(bytes)], 'Recorder.wav', { type: 'audio/wav' });
	// IndexedDB API fixtures isolate the actual production repositories; native
	// storage, chooser and rendered-file identity remain covered in the browser.
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const archive = createSoundscaperScapeNativeRuntime();
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = await constructController();
	context.after(async () => { try { await controller.dispose(); } finally { await recipient.close(); } });
	async function constructController() {
		try {
			return createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
				projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: archive,
				engine: { ...createMemoryEngine(), decodeAudioData: async () => assert.fail('Recorder PCM must use the production WAV reader') } as unknown as Options['engine'],
				ffmpeg: { ...createMemoryFfmpeg(), decode: async () => assert.fail('Recorder PCM must not use a substitute codec') } as unknown as Options['ffmpeg'],
				engineFactory: () => { throw new Error('Source metadata custody does not render PCM'); } });
		} catch (error) {
			await store.close(); await recipient.close(); throw error;
		}
	}
	await controller.ready;
	await controller.actions.project.importFiles([file]);
	await controller.actions.project.flush();
	const project = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.metadata.ixml?.rawXml, expectedXml);
	assert.equal(project.metadata.ixml?.fileSetId, 'TAKE-FAMILY-0001');
	assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 4800, 2]);
	assert.equal(project.clips[0]?.durationFrames, 4800);
	const origin = normalizeSourceProvenance(source.provenance).contributions[0]?.origin;
	assert.ok(origin?.kind === 'local-file'); assert.equal(origin.originalFileName, file.name); assert.equal(origin.byteLength, file.size);
	assertPcmChannelsEqual((await readPcm(store, source.storageKey)).map(channel => Float32Array.from(channel)), expected.channels, 'imported recorder PCM');
	assert.deepEqual(await store.loadProject(project.id), project);
	const exported = await archive.exportScapeProject(project, store); assert.ok(exported.blob);
	const reopened = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false); assert.ok(validateSoundscaperProject(reopened.project));
	assert.equal(reopened.project.metadata.ixml?.rawXml, expectedXml);
	assert.deepEqual(reopened.project, project);
	assert.deepEqual(await recipient.loadProject(project.id), project);
	const restored = reopened.project.sources[0]; assert.ok(restored?.kind === 'audio');
	assertPcmChannelsEqual((await readPcm(recipient, restored.storageKey)).map(channel => Float32Array.from(channel)), expected.channels, 'portable recorder PCM');
});

test('new rendered BWF ranges omit physical source identity and report the conversion', async () => {
	const project = await recorderProject();
	const source = structuredClone(project.metadata.ixml);
	for (const endFrame of [1920, 3840]) {
		const plan = createExportPlan(project, { format: 'bwf', channelMapping: 'preserve', bitDepth: 16, range: { startFrame: 0, endFrame } });
		assert.ok(plan.ixml); assert.doesNotMatch(plan.ixml.rawXml, /<FILE_UID>/u);
		assert.match(plan.ixml.rawXml, /<FAMILY_UID>TAKE-FAMILY-0001<\/FAMILY_UID>/u);
		assert.deepEqual(plan.ixml.tracks.map(track => track.channelIndex), [4, 6]);
		const report = createDeliveryReportForPlan(plan, { sampleRate: 48_000 });
		const omitted = report.items.find(item => item.code === warning);
		assert.ok(omitted); assert.equal(omitted.disposition, 'omitted'); assert.equal(omitted.severity, 'warning');
		assert.equal(plan.outputFrames, endFrame);
	}
	assert.deepEqual(project.metadata.ixml, source, 'native/source recorder identity remains untouched');
});

for (const mode of ['mix', 'stems', 'clips', 'chapters']) test(`new ${mode} files never claim the original physical FILE_UID`, async () => {
	const original = await recorderProject();
	const project = createSoundscaperProject({ ...original, sequences: undefined, tracks: [...original.tracks,
		{ id: 'labels', type: 'label', name: 'Chapters', labels: [{ id: 'a', title: 'First', startFrame: 0, endFrame: 2400 }, { id: 'b', title: 'Second', startFrame: 2400, endFrame: 4800 }] }] });
	const plan = createExportPlan(project, { format: 'bwf', mode, channelMapping: 'preserve', bitDepth: 16 });
	assert.ok(plan.ixml); assert.doesNotMatch(plan.ixml.rawXml, /<FILE_UID>/u);
	for (const output of plan.outputs) if (output.ixml) assert.doesNotMatch(output.ixml.rawXml, /<FILE_UID>/u);
	assert.equal(createDeliveryReportForPlan(plan, { sampleRate: 48_000 }).items.filter(item => item.code === warning).length, 1);
	assert.deepEqual(createExportPlan(project, { format: 'bwf', mode, channelMapping: 'preserve', bitDepth: 16 }), plan,
		'planned delivery remains deterministic for persistent exact-plan execution');
});

test('vendor file identifiers, inert text and ordinary metadata do not become physical-file warnings', async () => {
	const original = await recorderProject();
	const rawXml = '<BWFXML><PROJECT>Location</PROJECT><VENDOR><FILE_UID>Private recorder identity</FILE_UID></VENDOR>'
		+ '<!--<FILE_UID>Inert</FILE_UID>--><NOTE><![CDATA[<FILE_UID>Literal</FILE_UID>]]></NOTE></BWFXML>';
	const project = createSoundscaperProject({ ...original, metadata: { ixml: parseIxmlPayload(new TextEncoder().encode(rawXml)) } });
	const plan = createExportPlan(project, { format: 'bwf', channelMapping: 'preserve', bitDepth: 16 });
	assert.equal(plan.ixml?.rawXml, rawXml);
	assert.equal(createDeliveryReportForPlan(plan, { sampleRate: 48_000 }).items.some(item => item.code === warning), false);
});

test('same-file Original preserves identity only during its authorized adapter invocation', async () => {
	const project = await recorderProject();
	const encoded = await readFile(new URL('./fixtures/bwfmetaedit-file-uid.wav.base64', import.meta.url), 'utf8');
	const file = new File([Buffer.from(encoded.trim(), 'base64')], 'Recorder.wav', { type: 'audio/wav' });
	const fixture = createFixture();
	let current = createSoundscaperProject({ id: project.id, sampleRate: project.sampleRate });
	const plans: ReturnType<typeof createExportPlan>[] = [];
	const stopAtPlan = new Error('Plan captured before rendering');
	const service = createEditorExportService({ ...fixture.runtime, getProject: () => current,
		createExportPlan: (_project: unknown, options: Readonly<Record<string, unknown>>) => {
			plans.push(createExportPlan(project, options)); throw stopAtPlan;
		} });
	registerDesktopOriginalFile(file, { id: 'c'.repeat(48), name: file.name });
	await createDesktopOriginalImportRecorder({ state: fixture.state, getProject: () => ({ ...current }) }, async () => { current = project; })(file);
	let authorized: unknown;
	const actions = createOriginalOverwriteActions({ state: fixture.state, getProject: () => ({ ...current }),
		fileService: { originalOverwriteAvailable: true, prepareOriginalOverwrite: async () => ({ id: 'original-target' }) },
		handleExportAction: async (action, settings) => {
			authorized = settings; assert.equal(isOriginalOverwriteSettings(settings), true);
			assert.ok(settings && typeof settings === 'object');
			assert.equal(isOriginalOverwriteSettings({ ...settings }), false, 'copied settings have no original-file identity authority');
			return await service.handleExportAction(action, settings);
		} });
	try {
		assert.equal(actions.overwriteOriginalAvailable(), true);
		await actions.overwriteOriginal();
		const original = plans[0]; assert.ok(original);
		assert.match(original.ixml?.rawXml ?? '', /<FILE_UID>RECORDER-FILE-UNIQUE-0001<\/FILE_UID>/u);
		assert.equal(createDeliveryReportForPlan(original, { sampleRate: 48_000 }).items.some(item => item.code === warning), false);
		assert.equal(isOriginalOverwriteSettings(authorized), false, 'identity authority ends when the invocation settles');
		assert.ok(authorized && typeof authorized === 'object');
		await service.handleExportAction('start', { ...authorized, preserveIxmlFileIdentity: true, saveTarget: { id: 'new-file-target' } });
		const delivered = plans[1]; assert.ok(delivered);
		assert.doesNotMatch(delivered.ixml?.rawXml ?? '', /<FILE_UID>/u, 'a new-file saveTarget and caller field cannot claim Original identity');
		assert.deepEqual(fixture.errors, [stopAtPlan, stopAtPlan]);
	} finally { resetDesktopOriginal(fixture.state); }
});
