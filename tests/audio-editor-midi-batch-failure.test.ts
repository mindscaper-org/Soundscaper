/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, createMemoryEngine } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { writeMidiFile } from '../src/common/editor/midi-file.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';

const { createAudioEditorController } = await import('../src/common/editor/app.js');

for (const good of ['wav', 'midi'] as const) for (const badFirst of [true, false]) test(`batch preserves healthy ${good}, corrupt MIDI first=${badFirst}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture(`midi-error-${good}-${badFirst}`, { sampleRate: 48_000, tracks: [] });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: ENGLISH_COPY,
		store: fixture.store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.openById(fixture.project.id);
	const healthy = good === 'wav'
		? new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000 }))], 'Healthy.wav')
		: new File([Uint8Array.from(writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Healthy notes',
			notes: [{ id: 'note', channel: 0, pitch: 60, velocity: 80, startFrame: 0, durationFrames: 4800 }] }] }))], 'Healthy.mid');
	const bad = new File(['Not a MIDI file'], 'Broken.mid');
	const outcome = await Promise.allSettled([controller.actions.project.importFiles(badFirst ? [bad, healthy] : [healthy, bad])]);
	assert.equal(outcome[0]?.status, 'rejected', 'a partial batch still reports its MIDI failure');
	assert.equal(controller.project?.clips.length, 1, 'a failed sibling must not discard a healthy file later in the same user-selected batch');
});

for (const error of [new DOMException('Cancelled', 'AbortError'), Object.assign(new Error('Read aborted'), { code: 'ABORTED' }),
	Object.assign(new Error('Editor disposed'), { code: 'DISPOSED' }), new Error('Read cancelled', { cause: new DOMException('Cancelled', 'AbortError') })]) {
	test(`terminal read errors stop the remaining batch: ${error.message}`, async () => {
		const project = { id: 'owner', sampleRate: 48000 };
		let ordinaryImports = 0;
		const importer = createMidiImportFiles({ getProject: () => project, importFiles: () => { ordinaryImports++; } },
			async () => ({ importDocument: async () => [] }));
		await assert.rejects(importer.importFiles([{ name: 'cancel.mid', arrayBuffer: () => Promise.reject(error) },
			new File(['audio'], 'later.wav')]), caught => caught === error);
		assert.equal(ordinaryImports, 0);
	});
}

test('a failed file cannot adopt a project activated during its read', async () => {
	let project = { id: 'owner', sampleRate: 48000 };
	let ordinaryImports = 0;
	const importer = createMidiImportFiles({ getProject: () => project, importFiles: () => { ordinaryImports++; } },
		async () => ({ importDocument: async () => [] }));
	await assert.rejects(importer.importFiles([{ name: 'old.mid', arrayBuffer: () => {
		project = { id: 'replacement', sampleRate: 48000 };
		return Promise.reject(new Error('Old file failed'));
	} }, new File(['audio'], 'later.wav')]), { code: 'PROJECT_CHANGED' });
	assert.equal(ordinaryImports, 0);
});

test('a visible ordinary-import cancellation wins over an earlier bad MIDI file', async () => {
	const project = { id: 'owner', sampleRate: 48000 }, cancelled = { cancelled: true };
	let laterReads = 0;
	const importer = createMidiImportFiles({ getProject: () => project, importFiles: () => cancelled },
		async () => ({ importDocument: async () => [] }));
	const result = await importer.importFiles([new File(['bad'], 'broken.mid'), new File(['audio'], 'cancel.wav'),
		{ name: 'later.mid', arrayBuffer: () => { laterReads++; return Promise.reject(new Error('Cancelled files must not be read')); } }]);
	assert.strictEqual(result, cancelled);
	assert.equal(laterReads, 0);
});
