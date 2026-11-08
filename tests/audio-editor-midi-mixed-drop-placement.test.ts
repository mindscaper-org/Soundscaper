/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { writeMidiFile } from '../src/common/editor/midi-file.ts';

for (const order of [
	['First.wav', 'Second.wav'], ['First.wav', 'Second.wav', 'Notes.mid'], ['First.wav', 'Notes.mid', 'Second.wav'],
	['Broken.wav', 'Notes.mid', 'Second.wav'], ['First.wav', 'Broken.wav', 'Notes.mid', 'Second.wav'],
]) test(`mixed file drop preserves ordinary batch placement for ${order.join(',')}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture('midi-drop-placement', { sampleRate: 48_000, tracks: [
		{ id: 'bed', name: 'Bed', input: new Float32Array(4800) }, { id: 'below', name: 'Below', input: new Float32Array(4800) },
	] });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: ENGLISH_COPY,
		store: fixture.store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.openById(fixture.project.id);
	const files = order.map(name => new File([Uint8Array.from(name.endsWith('.mid')
		? writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Notes', notes: [
			{ id: 'n', channel: 0, pitch: 60, velocity: 100, startFrame: 0, durationFrames: 4800 },
		] }] }) : name === 'Broken.wav' ? new Uint8Array([1, 2, 3])
			: encodeWav([new Float32Array(4800).fill(0.1)], { sampleRate: 48_000 }))], name));
	await controller.actions.project.importFiles(files, { destination: 'timeline', trackId: 'bed', timelineStartFrame: 48_000 });
	const project = controller.project; assert.ok(project);
	const sourceName = new Map(project.sources.map(source => [source.id, source.name]));
	const second = project.clips.find(clip => sourceName.get(clip.sourceId) === 'Second.wav'); assert.ok(second);
	const secondOwner = project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(second.id)); assert.ok(secondOwner);
	assert.equal(second.timelineStartFrame, 48_000);
	if (order.includes('First.wav')) {
		const first = project.clips.find(clip => sourceName.get(clip.sourceId) === 'First.wav'); assert.ok(first);
		const bed = project.tracks.find(track => track.id === 'bed'); assert.ok(bed && Array.isArray(bed.clipIds));
		assert.ok(bed.clipIds.includes(first.id));
		assert.notEqual(secondOwner.id, 'bed', 'the second ordinary file belongs on a new lane');
		assert.equal(project.tracks.indexOf(secondOwner), project.tracks.findIndex(track => track.id === 'bed') + 1);
	} else assert.equal(secondOwner.id, 'bed', 'a failed import cannot consume the original destination');
});
