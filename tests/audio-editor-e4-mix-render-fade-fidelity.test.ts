/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createNodeWebAudioEngineFactory, type NodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

for (const mixDown of [true, false]) test(`Mix & Render does not add fades to already-rendered audio, mixDown=${mixDown}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const original = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800, fadeInFrames: 96, fadeOutFrames: 96 });
	const project = createSoundscaperProject({ id: `baked-fades-${mixDown}`, sources: [source], clips: [original],
		tracks: [createAudioTrack({ id: 'voice', clipIds: [original.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `baked-fades-${mixDown}` });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(.25)]); await writer.commit();
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(0, 4800, { trackIds: ['voice'] });
	const printed = await controller.actions.track.mixAndRender({ mixDown, renderEffects: true, replaceOriginals: true });
	assert.ok(printed);
	const clip = controller.project?.clips.find(value => value.id === printed.clipId);
	assert.ok(clip); assert.equal(clip.fadeInFrames, 0); assert.equal(clip.fadeOutFrames, 0);
	controller.actions.edit.undo();
	assert.equal(controller.project?.clips.find(value => value.id === original.id)?.fadeInFrames, 96);
	controller.actions.edit.redo();
	assert.equal(controller.project?.clips.find(value => value.id === printed.clipId)?.fadeInFrames, 0);
});

test('Flatten comp publishes its complete rendered programme without adding new edge fades', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const source = createAudioSource({ id: 'take', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const project = createSoundscaperProject({ id: 'flatten-fades', sources: [source], tracks: [createAudioTrack({ id: 'voice', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'comp', sequenceId: 'main', trackId: 'voice', startSample: 0, endSample: 4800,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 4800, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 4800 }] }],
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'flatten-fades' });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(.25)]); await writer.commit();
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	await controller.actions.takeComp.flatten('comp');
	const clip = controller.project?.clips[0]; assert.ok(clip);
	assert.equal(clip.fadeInFrames, 0); assert.equal(clip.fadeOutFrames, 0);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.takeGroups, project.takeGroups);
	controller.actions.edit.redo(); assert.equal(controller.project?.clips[0]?.fadeInFrames, 0);
});

const RECORDING_FRAMES = 12_000;
type RealSession = Awaited<ReturnType<typeof controllerSession>>;

/** The byte digest is independently generated by the original browser createWavFixture. */
function originalStereoRecording() {
	const bytes = Buffer.alloc(44 + RECORDING_FRAMES * 4);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
	bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(192_000, 28);
	bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	const pcm = [new Float32Array(RECORDING_FRAMES), new Float32Array(RECORDING_FRAMES)];
	for (let frame = 0; frame < RECORDING_FRAMES; frame++) for (let channel = 0; channel < 2; channel++) {
		const sample = Math.round(Math.sin(2 * Math.PI * 1_000 * frame / 48_000 + (channel ? Math.PI / 3 : 0)) * .25 * 32_767);
		bytes.writeInt16LE(sample, 44 + (frame * 2 + channel) * 2); pcm[channel]![frame] = (sample || 0) / 32_768;
	}
	assert.equal(createHash('sha256').update(bytes).digest('hex'), '517dd28f9aaead48d50648ab567ed299a814b54c10240c0f513208792e606ca6');
	return { file: new File([bytes], 'Recording.wav', { type: 'audio/wav' }), pcm };
}

async function renderCurrentProgramme(session: RealSession, native: NodeWebAudioEngineFactory) {
	const project = clipboardProject(session.controller.project), renderer = native.createEngine();
	try {
		const buffers = new Map<string, AudioBuffer>();
		for (const source of project.sources) {
			assert.ok(source.kind === 'audio');
			const clip = project.clips.find(clip => clip.sourceId === source.id); if (!clip) continue;
			const visual = session.controller.getClipVisualData(clip.id);
			const buffer = visual?.buffer ?? await session.store.loadSourceAudioBuffer(source.storageKey, await renderer.getAudioContext({ resume: false }));
			assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
		}
		renderer.loadProject(projectForRuntimeConsumers(project), buffers);
		const buffer = await renderer.renderMix({ startFrame: 0, endFrame: RECORDING_FRAMES }); assert.ok(buffer instanceof AudioBuffer);
		assert.deepEqual([buffer.numberOfChannels, buffer.length, buffer.sampleRate], [2, RECORDING_FRAMES, 48_000]);
		return Array.from({ length: 2 }, (_, channel) => {
			const samples = new Float32Array(RECORDING_FRAMES); buffer.copyFromChannel(samples, channel); return samples;
		});
	} finally { await renderer.dispose(); }
}

function assertProgrammeClose(actual: readonly Float32Array[], expected: readonly Float32Array[], label: string) {
	assert.equal(actual.length, 2); assert.equal(expected.length, 2);
	for (let channel = 0; channel < 2; channel++) {
		assert.equal(actual[channel]!.length, RECORDING_FRAMES); assert.equal(expected[channel]!.length, RECORDING_FRAMES);
		for (let frame = 0; frame < RECORDING_FRAMES; frame++) {
			if (!(Math.abs(actual[channel]![frame]! - expected[channel]![frame]!) < .0001))
				assert.fail(`${label} channel ${channel}, frame ${frame}: ${actual[channel]![frame]} versus ${expected[channel]![frame]}`);
		}
	}
}

function assertIndependentEdges(actual: readonly Float32Array[], input: readonly Float32Array[], microfades: boolean) {
	assert.equal(actual.length, 2);
	for (let channel = 0; channel < 2; channel++) {
		assert.equal(actual[channel]!.length, RECORDING_FRAMES);
		for (let frame = 0; frame < RECORDING_FRAMES; frame++) {
			const fadeIn = microfades && frame < 96 ? Math.sin(frame / 96 * Math.PI / 2) : 1;
			const fadeOut = microfades && frame > RECORDING_FRAMES - 96 ? Math.sin((RECORDING_FRAMES - frame) / 96 * Math.PI / 2) : 1;
			const expected = input[channel]![frame]! * fadeIn * fadeOut;
			// The native graph interpolates its sampled gain curve at the authored edges.
			const tolerance = microfades && (frame < 96 || frame > RECORDING_FRAMES - 96) ? .0003 : 1e-7;
			if (!(Math.abs(actual[channel]![frame]! - expected) < tolerance))
				assert.fail(`Independent recorded endpoint channel ${channel}, frame ${frame}: ${actual[channel]![frame]} versus ${expected}`);
		}
	}
}

for (const mixDown of [true, false]) for (const microfades of [true, false]) {
	test(`real ${mixDown ? 'Combined' : 'Individual'} print retains original RIFF endpoints with new-clip fades ${microfades}`, { timeout: 20_000 }, async context => {
		const native = createNodeWebAudioEngineFactory(context);
		const session = await controllerSession(context, { engine: native.createEngine(), engineFactory: native.createEngine });
		const { controller, store } = session;
		try {
			const recording = originalStereoRecording(), originalTracks = clipboardProject(controller.project).tracks.length;
			await controller.actions.preferences.update({ editing: { applyMicrofadesToNewClips: microfades } });
			const preferences = controller.getSnapshot().preferences;
			assert.ok(preferences && typeof preferences === 'object' && 'editing' in preferences);
			assert.ok(preferences.editing && typeof preferences.editing === 'object' && 'applyMicrofadesToNewClips' in preferences.editing);
			assert.equal(preferences.editing.applyMicrofadesToNewClips, microfades);
			await controller.actions.project.importFiles([recording.file]);
			const imported = clipboardProject(controller.project), originalClip = imported.clips[0], source = imported.sources[0];
			assert.ok(originalClip?.kind === 'audio' && source?.kind === 'audio');
			assert.equal(imported.tracks.length, originalTracks + 1); assert.equal(imported.clips.length, 1); assert.equal(imported.sources.length, 1);
			assert.deepEqual([source.name, source.frameCount, source.sampleRate, source.channelCount], ['Recording.wav', RECORDING_FRAMES, 48_000, 2]);
			assert.deepEqual([originalClip.sourceId, originalClip.timelineStartFrame, originalClip.sourceStartFrame,
				originalClip.durationFrames, originalClip.sourceDurationFrames], [source.id, 0, 0, RECORDING_FRAMES, RECORDING_FRAMES]);
			assert.deepEqual([originalClip.fadeInFrames, originalClip.fadeOutFrames], microfades ? [96, 96] : [0, 0]);
			if (microfades) assert.deepEqual([originalClip.fadeInShape, originalClip.fadeOutShape], [1, 1]);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), recording.pcm, 'original RIFF16 source');
			controller.actions.timeline.selectClip(originalClip.id);
			const beforeProject = clipboardProject(controller.project), before = await renderCurrentProgramme(session, native);
			assertIndependentEdges(before, recording.pcm, microfades);
			const undoEntries = controller.getSnapshot().history.undoEntries.length, contexts = native.snapshot().offlineContexts;
			const printed = await controller.actions.track.mixAndRender({ mixDown, renderEffects: true, replaceOriginals: true }); assert.ok(printed);
			assert.equal(native.snapshot().offlineContexts, contexts + 1, 'the original short profile uses the real buffered renderSnapshot path');
			const afterProject = clipboardProject(controller.project), clip = afterProject.clips.find(clip => clip.id === printed.clipId);
			const renderedSource = afterProject.sources.find(source => source.id === printed.sourceId);
			assert.ok(clip?.kind === 'audio' && renderedSource?.kind === 'audio');
			assert.equal(afterProject.clips.length, 1); assert.equal(afterProject.tracks.length, beforeProject.tracks.length);
			assert.notEqual(clip.id, originalClip.id); assert.notEqual(renderedSource.id, source.id);
			assert.deepEqual([clip.sourceId, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames,
				clip.sourceDurationFrames, clip.fadeInFrames, clip.fadeOutFrames], [renderedSource.id, 0, 0, RECORDING_FRAMES, RECORDING_FRAMES, 0, 0]);
			assert.deepEqual([renderedSource.frameCount, renderedSource.channelCount, renderedSource.sampleRate, renderedSource.sampleFormat], [RECORDING_FRAMES, 2, 48_000, 'float32']);
			assert.equal(controller.getSnapshot().history.undoEntries.length, undoEntries + 1);
			const publishedPcm = await readCustodyPcm(store, renderedSource);
			assertProgrammeClose(publishedPcm, before, 'stored programme'); assertIndependentEdges(publishedPcm, recording.pcm, microfades);
			const after = await renderCurrentProgramme(session, native); assertProgrammeClose(after, before, 'printed programme');
			assertIndependentEdges(after, recording.pcm, microfades);
			controller.actions.edit.undo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(beforeProject));
			assertProgrammeClose(await renderCurrentProgramme(session, native), before, 'Undo programme');
			controller.actions.edit.redo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(afterProject));
			assertProgrammeClose(await renderCurrentProgramme(session, native), after, 'Redo programme');
			assertPcmChannelsEqual(await readCustodyPcm(store, renderedSource), publishedPcm, 'Redo persisted rendered source');
			assertPcmChannelsEqual(await readCustodyPcm(store, source), recording.pcm, 'original source after print and history');
			await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(afterProject.id), controller.project);
			assert.deepEqual(await store.loadSetting('soundscaper:audio-editor-preferences-v1'), preferences);
			assert.ok(native.snapshot().worklets.every(worklet => worklet.processorErrors.length === 0));
		} finally { await controller.dispose(); await native.dispose(); }
	});
}
