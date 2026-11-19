/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { evaluateClipFadeAt } from '../src/common/editor/audio-clip-transition-gain.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readWavePcm } from './helpers/read-wave-pcm.ts';

function project(edge: 'in' | 'out', shape: number | undefined) {
	return createCurrentAudioEditorProject({ id: 'fades', sampleRate: 8000,
		sources: [{ id: 'source', name: 'Voice.wav', storageKey: 'source', frameCount: 8000, channelCount: 1, sampleRate: 8000, originalSampleRate: 8000, sampleFormat: 'float32', chunkFrames: 8000 }],
		tracks: [{ type: 'audio', id: 'voice', name: 'Voice', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', title: 'Voice', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 8000, durationFrames: 8000,
			...(edge === 'in' ? { fadeInFrames: 3200, ...(shape === undefined ? {} : { fadeInShape: shape }) }
				: { fadeOutFrames: 3200, ...(shape === undefined ? {} : { fadeOutShape: shape }) }) }] });
}

for (const edge of ['in', 'out'] as const) test(`DAWproject discloses a constant-power fade-${edge} that reimports as linear`, async context => {
	const authored = project(edge, 1); assert.ok(validateAudioEditorProjectV17(authored));
	const output = createDawprojectExport({ project: { ...authored } });
	let id = 0;
	const imported = buildDawprojectProject(parseDawprojectDocument(output.projectXml, output.metadataXml), {
		sampleRate: 8000, createStableId: prefix => `${prefix}-${++id}`,
		media: new Map(output.media.map(entry => [entry.path, { sampleRate: 8000, channelCount: 1, frameCount: 8000 }])) });
	const reopened = createCurrentAudioEditorProject(imported.project); assert.ok(validateAudioEditorProjectV17(reopened));
	const clip = reopened.clips[0]!; assert.ok(typeof clip.durationFrames === 'number');
	const frame = edge === 'in' ? 800 : clip.durationFrames - 800;
	const shape = edge === 'in' ? clip.fadeInShape : clip.fadeOutShape;
	assert.equal(shape, undefined);
	assert.equal(evaluateClipFadeAt(frame, clip.durationFrames, 3200, edge, shape), 0.25);
	assert.ok(Math.abs(evaluateClipFadeAt(frame, clip.durationFrames, 3200, edge, 1) - 0.3826834323650898) < 1e-12);
	const omission = output.report.items.find(item => item.code === 'dawproject.clip-features-omitted');
	assert.deepEqual(omission?.data.features, [edge === 'in' ? 'fadeInShape' : 'fadeOutShape']);
	await actualFadeCustody(context, edge, 1);
});

for (const shape of [undefined, 2, 0.5]) test(`DAWproject keeps the existing omission policy for ${shape ?? 'linear'} fade shape`, async context => {
	const output = createDawprojectExport({ project: { ...project('in', shape) } });
	assert.match(output.projectXml, /fadeInTime="0\.4"/u);
	const omission = output.report.items.find(item => item.code === 'dawproject.clip-features-omitted');
	if (shape === undefined) assert.equal(omission, undefined);
	else assert.deepEqual(omission?.data.features, ['fadeInShape']);
	await actualFadeCustody(context, 'in', shape);
});

/** Actual browser-source profile; no native audio decoder or substitute renderer is used. */
async function actualFadeCustody(context: TestContext, edge: 'in' | 'out', shape: number | undefined) {
	const pcm = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: 38_400 }, (_, frame) =>
		Math.round(Math.sin(2 * Math.PI * 330 * frame / 48_000 + (channel ? Math.PI / 3 : 0)) * .35 * 32767) / 32768 || 0));
	const input = new File([Uint8Array.from(encodeWav(pcm, { sampleRate: 48_000, bitDepth: 16, dither: 'none' }))], 'browser-tone-a.wav', { type: 'audio/wav' });
	const saved: Blob[] = [];
	const fileService = { ...createAudioEditorFileService({ bridge: null, scope: {}, document: null }), async saveFile(request: unknown = {}) {
		assert.ok(request && typeof request === 'object');
		const blob: unknown = Reflect.get(request, 'blob'), name: unknown = Reflect.get(request, 'suggestedName');
		assert.ok(blob instanceof Blob && typeof name === 'string'); saved.push(blob);
		return { method: 'node-file-transport', fileName: name, size: blob.size };
	} };
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const engine = { ...createMemoryEngine(), decodeAudioData: async () => assert.fail('The physical WAV must use its PCM reader') };
	const ffmpeg = { ...createMemoryFfmpeg(), decode: async () => assert.fail('DAW PCM cannot use a codec substitute') };
	const native = createSoundscaperScapeNativeRuntime();
	const options = { fileService, scapeProjectRuntime: native, adaptAudacityProject: importSoundscaperAudacityProject,
		engine: engine as unknown as Options['engine'],
		ffmpeg: ffmpeg as unknown as Options['ffmpeg'], engineFactory: () => assert.fail('DAW source exchange must not synthesize rendered audio') };
	const { controller, store } = await controllerSession(context, options);
	await controller.actions.project.importFiles([input]);
	const before = clipboardProject(controller.project), clip = before.clips[0], source = before.sources[0];
	assert.ok(clip?.kind === 'audio' && source?.kind === 'audio'); assert.equal(before.masterChannels, 2);
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 38_400, 2]);
	assertPcmChannelsEqual(await readCustodyPcm(store, source), pcm, 'independent original browser recording');
	const field = edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames', shapeField = edge === 'in' ? 'fadeInShape' : 'fadeOutShape';
	assert.equal(clip[field], 96, 'the native browser profile starts with the ordinary 2ms import microfade');
	assert.equal(clip.fadeInShape, 1); assert.equal(clip.fadeOutShape, 1);
	const history = controller.getSnapshot().history.undoEntries.length;
	// The reachable handle route nudges100ms, retaining the initial2ms fade.
	// Applying Linear explicitly clears that edge; its opposite microfade stays.
	await controller.actions.clip.update(clip.id, { [field]: 19_296, [shapeField]: shape });
	const authored = clipboardProject(controller.project), authoredClip = authored.clips[0]; assert.ok(authoredClip?.kind === 'audio');
	assert.equal(authoredClip[field], 19_296); assert.equal(authoredClip[shapeField] ?? undefined, shape);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, authored.clips);
	const afterHistory = clipboardProject(controller.project);
	assert.deepEqual({ ...afterHistory, revision: authored.revision, updatedAt: authored.updatedAt }, authored);
	await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(afterHistory.id), afterHistory);
	const exported = await controller.actions.project.saveDawproject();
	assert.deepEqual(controller.project, afterHistory); assert.deepEqual(controller.getSnapshot().deliveryReport, exported.report);
	assert.ok(exported.report && typeof exported.report === 'object');
	const items: unknown = Reflect.get(exported.report, 'items'); assert.ok(Array.isArray(items));
	const omissions = items.filter((item: unknown) => item && typeof item === 'object' && Reflect.get(item, 'code') === 'dawproject.clip-features-omitted');
	assert.equal(omissions.length, 1);
	const data: unknown = Reflect.get(omissions[0], 'data'); assert.ok(data && typeof data === 'object');
	assert.deepEqual(Reflect.get(data, 'features'), shape === undefined ? ['fadeOutShape'] : ['fadeInShape', 'fadeOutShape']);
	assert.equal(saved.length, 1); const blob = saved[0]; assert.ok(blob);
	const archive = await readDawprojectArchive(blob);
	try {
		assert.match(archive.projectXml, new RegExp(`${edge === 'in' ? 'fadeIn' : 'fadeOut'}Time="0\\.402"`));
		const audio = archive.entryNames.filter(name => name.endsWith('.wav')); assert.equal(audio.length, 1);
		const embedded = await archive.readEntry(audio[0]!); assert.ok(embedded);
		assertPcmChannelsEqual(readWavePcm(new Uint8Array(await embedded.arrayBuffer())).channels, pcm, 'actual DAW ZIP WAV bytes');
	} finally { await archive.close(); }
	const recipient = await controllerSession(context, options);
	const opened = await recipient.controller.actions.project.openDawproject(new File([blob], 'Fades.dawproject')); assert.ok(opened);
	const restored = clipboardProject(recipient.controller.project), restoredClip = restored.clips[0], restoredSource = restored.sources[0];
	assert.ok(restoredClip?.kind === 'audio' && restoredSource?.kind === 'audio');
	assert.deepEqual([restored.sampleRate, restoredClip.timelineStartFrame, restoredClip.durationFrames, restoredClip.sourceStartFrame, restoredClip.sourceDurationFrames], [48_000, 0, 38_400, 0, 38_400]);
	assert.deepEqual([restoredSource.sampleRate, restoredSource.frameCount, restoredSource.channelCount], [48_000, 38_400, 2]);
	assert.equal(restoredClip[field], 19_296); assert.equal(restoredClip[shapeField] ?? undefined, undefined);
	assert.equal(evaluateClipFadeAt(edge === 'in' ? 4824 : 38_400 - 4824, 38_400, 19_296, edge, undefined), .25);
	assertPcmChannelsEqual(await readCustodyPcm(recipient.store, restoredSource), pcm, 'every physical DAW-reopened source sample');
	await recipient.controller.actions.project.flush(); assert.deepEqual(await recipient.store.loadProject(restored.id), restored);
	if (edge === 'in' && shape === 1) {
		const portable = await native.exportScapeProject(restored, recipient.store); assert.ok(portable.blob);
		const fresh = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		context.after(async () => { await fresh.close(); });
		const reopened = await native.importScapeProject(portable.blob, fresh); assert.equal(reopened.readOnly, false);
		assert.deepEqual(reopened.project, restored); assert.deepEqual(await fresh.loadProject(restored.id), restored);
		const freshSource = clipboardProject(reopened.project).sources[0]; assert.ok(freshSource?.kind === 'audio');
		assertPcmChannelsEqual(await readCustodyPcm(fresh, freshSource), pcm, 'every DAW source sample after independent Scape');
	}
}
