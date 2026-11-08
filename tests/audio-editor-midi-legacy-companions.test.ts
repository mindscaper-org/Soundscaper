/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { decodeAuBlockFile } from '../src/common/editor/aup-legacy.js';
import { writeMidiFile } from '../src/common/editor/midi-file.ts';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

function midiFile(): File {
	return new File([Uint8Array.from(writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Extra MIDI',
		notes: [{ id: 'n', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 4800 }] }] }))], 'Extra MIDI.mid');
}

async function fixture(name: string) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const codec = { ...createMemoryFfmpeg(), decode: async (file: File) => ({
		channels: [decodeAuBlockFile(new Uint8Array(await file.arrayBuffer()))], sampleRate: 48_000,
	}) };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'] });
	await controller.ready;
	return { controller, store };
}

for (const midiFirst of [false, true]) for (const extraAudio of [false, true]) {
	test(`mixed legacy AUP keeps selected blocks and independent media: MIDI first=${midiFirst}, extra=${extraAudio}`, async context => {
		const { controller, store } = await fixture(context.name);
		context.after(async () => { await controller.dispose(); });
		const { projectFile, dataFile } = legacyAupFiles('utf-8');
		const bytes = new Uint8Array(await dataFile.arrayBuffer()), view = new DataView(bytes.buffer);
		for (let index = 0; index < 4800; index++) view.setFloat32(24 + index * 4, -.5);
		const independent = new File([bytes.buffer], 'Independent.au', { type: 'audio/basic' });
		const files = midiFirst ? [midiFile(), projectFile, dataFile] : [projectFile, midiFile(), dataFile];
		if (extraAudio) files.push(independent);
		await controller.actions.project.importFiles(files);
		const project: unknown = controller.project;
		assert.ok(validateSoundscaperProject(project));
		assert.equal(project.clips.length, extraAudio ? 3 : 2, 'the MIDI wrapper must not split a legacy project from its already-selected blocks');
		const legacyTrack = project.tracks.find(track => track.name === 'Voix 日本語 🎙');
		assert.ok(legacyTrack?.type === 'audio');
		assert.ok(project.tracks.some(track => track.name === 'Extra MIDI'));
		assert.equal(project.timelineAnnotations[0]?.name, 'Repère 日本語 🎵');
		const legacyClip = project.clips.find(clip => legacyTrack.clipIds.includes(clip.id)); assert.ok(legacyClip);
		const source = project.sources.find(item => item.id === legacyClip.sourceId);
		assert.ok(source);
		const chunk = await store.readSourceChunk(source.storageKey, 0);
		assert.ok(chunk);
		assert.equal(chunk.frames, 4800);
		assert.deepEqual(Array.from(chunk.channels[0]?.subarray(0, 2) ?? []), [.25, -.25]);
		if (extraAudio) {
			const extra = project.sources.find(item => item.name === independent.name); assert.ok(extra);
			const pcm = await store.readSourceChunk(extra.storageKey, 0); assert.ok(pcm);
			assert.equal(pcm.channels[0]?.[0], -.5);
		}
	});
}

for (const midiFirst of [false, true]) test(`mixed batch refuses multiple legacy projects before publishing MIDI: first=${midiFirst}`, async context => {
	const { controller, store } = await fixture(context.name);
	context.after(async () => { await controller.dispose(); });
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const second = new File([await projectFile.arrayBuffer()], 'Second.aup');
	const before = controller.project;
	await assert.rejects(controller.actions.project.importFiles(midiFirst ? [midiFile(), projectFile, dataFile, second]
		: [projectFile, midiFile(), second, dataFile]), /one legacy Audacity project/iu);
	assert.strictEqual(controller.project, before);
	assert.deepEqual(await store.listSources(), []);
});

test('cancelled legacy transaction returns before loading any selected MIDI', async () => {
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const cancelled = { cancelled: true, detail: 'retained' }, project = { id: 'owner', sampleRate: 48_000 };
	const batches: unknown[][] = [];
	const route = createMidiImportFiles({ getProject: () => project, importFiles: files => { batches.push([...files]); return cancelled; } },
		() => assert.fail('A cancelled legacy transaction cannot load the MIDI service'));
	assert.strictEqual(await route.importFiles([midiFile(), projectFile, dataFile]), cancelled);
	assert.deepEqual(batches, [[projectFile, dataFile]]);
});

test('legacy project clock is adopted before parsing a MIDI selected earlier in the picker', async () => {
	let project = { id: 'outgoing', sampleRate: 48_000 };
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	let noteEnd = 0;
	const route = createMidiImportFiles({ getProject: () => project, importFiles: files => {
		assert.deepEqual(files, [projectFile, dataFile]); project = { id: 'incoming', sampleRate: 44_100 };
	} }, async () => ({ importDocument: async document => {
		assert.equal(document.sampleRate, 44_100);
		assert.equal(project.id, 'incoming'); noteEnd = document.tracks[0]?.notes[0]?.durationFrames ?? 0;
		return [];
	} }));
	await route.importFiles([midiFile(), projectFile, dataFile]);
	assert.equal(noteEnd, 4410);
});

test('ordinary mixed media without a legacy project keeps its file order and placement options', async () => {
	const project = { id: 'owner', sampleRate: 48_000 }, sequence: string[] = [];
	const options = { destination: 'timeline', trackId: 'target', timelineStartFrame: 1234 };
	const route = createMidiImportFiles({ getProject: () => project, importFiles: (files, settings) => {
		sequence.push(String(files[0]?.name));
		assert.deepEqual(settings, { ...options, fileIndexOffset: sequence.length === 1 ? 0 : 1 });
		return { importedFileCount: 1 };
	} }, async () => ({ importDocument: async (_document, settings) => { sequence.push('MIDI'); assert.deepEqual(settings, options); return []; } }));
	await route.importFiles([new File(['audio'], 'First.wav'), midiFile(), new File(['audio'], 'Last.wav')], options);
	assert.deepEqual(sequence, ['First.wav', 'MIDI', 'Last.wav']);
});
