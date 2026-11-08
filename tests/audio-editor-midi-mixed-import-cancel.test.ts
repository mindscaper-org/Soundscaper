/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { deferred } from './helpers/async-test-control.ts';
import { writeMidiFile } from '../src/common/editor/midi-file.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';

function midiFile(): File {
	return new File([writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Later tune',
		notes: [{ id: 'n', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 4800 }] }] })], 'Later.mid');
}
for (const cancel of [false, true]) test(`public mixed WAV/MIDI import retains the batch decision cancel=${cancel}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture(`midi-mixed-cancel-${cancel}`, { sampleRate: 48_000, tracks: [] });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: ENGLISH_COPY,
		store: fixture.store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready; await controller.actions.project.openById(fixture.project.id);
	const entered = deferred<void>(), release = deferred<void>();
	context.after(async () => { release.resolve(); await controller.dispose(); });
	const begin = fixture.store.beginSourceWrite.bind(fixture.store);
	fixture.store.beginSourceWrite = async (...args: Parameters<typeof begin>) => {
		entered.resolve(); await release.promise; return begin(...args);
	};
	const wav = new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(0.25)], { sampleRate: 48_000 }))], 'Take.wav');
	const pending = controller.actions.project.importFiles([wav, midiFile()]);
	const outcome = Promise.allSettled([pending]);
	await entered.promise;
	if (cancel) assert.equal(controller.actions.project.cancelTask(), true);
	release.resolve();
	const result = (await outcome)[0]!;
	assert.equal(result.status, 'fulfilled');
	assert.equal(controller.project?.clips.length, cancel ? 0 : 2);
	if (cancel && result.status === 'fulfilled') assert.deepEqual(result.value, { cancelled: true });
});

test('the mixed MIDI wrapper returns the original cancellation before reading later files', async () => {
	const project = { id: 'owner', sampleRate: 48_000 }, cancellation = { cancelled: true, retained: 'detail' };
	let midiReads = 0;
	const importer = createMidiImportFiles({ getProject: () => project, importFiles: () => cancellation },
		() => { midiReads++; throw new Error('A cancelled batch cannot load MIDI'); });
	const result = await importer.importFiles([new File(['audio'], 'Take.wav'), midiFile()]);
	assert.strictEqual(result, cancellation);
	assert.equal(midiReads, 0);
});
