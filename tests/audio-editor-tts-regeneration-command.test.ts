/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRegenerateTtsClipCommand, createAddSourceCommand } from
	'../src/common/editor/commands.js';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from
	'../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';

const NOW = '2026-09-22T00:00:00.000Z';
const oldSource = Object.freeze({
	id: 'tts-old', name: 'Generated speech', mimeType: 'audio/wav', storageKey: 'tts-old',
	frameCount: 100, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	sampleFormat: 'float32', chunkFrames: 65_536, opaqueExtensions: {},
});

function project() {
	return createCurrentAudioEditorProject({
		id: 'tts-regeneration-command', now: NOW,
		sources: [oldSource],
		tracks: [{ type: 'audio', id: 'voice-track', name: 'Voice',
			clipIds: ['tts-clip', 'next-clip'] }],
		clips: [{
			id: 'tts-clip', sourceId: oldSource.id, title: 'Voice line',
			timelineStartFrame: 100, sourceStartFrame: 0,
			sourceDurationFrames: 100, durationFrames: 100,
			gain: 0.75, reversed: true, fadeInFrames: 10, fadeOutFrames: 20,
			envelope: [{ frame: 0, value: 0.5 }, { frame: 100, value: 1 }],
			trimStartFrames: 0, trimEndFrames: 0,
		}, {
			id: 'next-clip', sourceId: oldSource.id, title: 'Next line',
			timelineStartFrame: 300, sourceStartFrame: 0,
			sourceDurationFrames: 100, durationFrames: 100,
			trimStartFrames: 0, trimEndFrames: 0,
		}],
	});
}

function generated(frameCount: number, sampleRate = 48_000) {
	return { ...oldSource, id: `tts-new-${String(frameCount)}`,
		storageKey: `tts-new-${String(frameCount)}`, frameCount,
		sampleRate, originalSampleRate: sampleRate };
}

test('regenerating TTS keeps clip identity, track, start and compatible edits with the new duration', () => {
	const source = generated(150);
	const original = project();
	let history = createEditorHistory(original);
	history = executeEditorCommand(history, { type: 'batch', commands: [
		createAddSourceCommand(source), createRegenerateTtsClipCommand('tts-clip', source.id),
	] }, { now: NOW });
	const clip = history.present.clips.find(({ id }: { id: string }) => id === 'tts-clip')!;
	assert.equal(clip.id, 'tts-clip');
	assert.equal(clip.sourceId, source.id);
	assert.equal(clip.timelineStartFrame, 100);
	assert.equal(clip.durationFrames, 150);
	assert.equal(clip.sourceStartFrame, 0);
	assert.equal(clip.sourceDurationFrames, 150);
	assert.equal(clip.gain, 0.75);
	assert.equal(clip.reversed, true);
	assert.equal(clip.fadeInFrames, 10);
	assert.equal(clip.fadeOutFrames, 20);
	assert.deepEqual(clip.envelope, [{ frame: 0, value: 0.5 }, { frame: 100, value: 1 }]);
	assert.deepEqual(history.present.tracks.find(({ id }) => id === 'voice-track')?.clipIds,
		['tts-clip', 'next-clip']);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(history.present.clips.find(({ id }: { id: string }) => id === 'tts-clip'),
		original.clips.find(({ id }: { id: string }) => id === 'tts-clip'));
});

test('shorter TTS regeneration clips fades and preserves envelope value at the new end', () => {
	const source = generated(40);
	const history = executeEditorCommand(createEditorHistory(project()), {
		type: 'batch', commands: [createAddSourceCommand(source),
			createRegenerateTtsClipCommand('tts-clip', source.id)],
	}, { now: NOW });
	const clip = history.present.clips.find(({ id }: { id: string }) => id === 'tts-clip')!;
	assert.equal(clip.durationFrames, 40);
	assert.deepEqual(clip.envelope, [{ frame: 0, value: 0.5 }, { frame: 40, value: 0.7 }]);
});

test('24 kHz generated audio gets an exact 48 kHz project timeline duration', () => {
	const source = generated(75, 24_000);
	const history = executeEditorCommand(createEditorHistory(project()), {
		type: 'batch', commands: [createAddSourceCommand(source),
			createRegenerateTtsClipCommand('tts-clip', source.id)],
	}, { now: NOW });
	const clip = history.present.clips.find(({ id }: { id: string }) => id === 'tts-clip')!;
	assert.equal(clip.durationFrames, 150);
	assert.equal(clip.sourceDurationFrames, 75);
	assert.equal(clip.timelineStartFrame, 100);
});

test('TTS regeneration refuses overlap without publishing a partial command', () => {
	const source = generated(201);
	const original = project();
	assert.throws(() => executeEditorCommand(createEditorHistory(original), {
		type: 'batch', commands: [createAddSourceCommand(source),
			createRegenerateTtsClipCommand('tts-clip', source.id)],
	}, { now: NOW }), /overlap/u);
	assert.equal(original.sources.some(({ id }) => id === source.id), false);
	assert.equal(original.clips.find(({ id }: { id: string }) => id === 'tts-clip')?.durationFrames, 100);
});

test('TTS regeneration checks neighboring clips against the retained speed', () => {
	for (const speedRatio of [0.5, 2]) {
		const history = executeEditorCommand(createEditorHistory(project()), { type: 'clip/transform-many', transforms: [{
			clipId: 'tts-clip', trackId: 'voice-track', changes: { speedRatio, durationFrames: 100 / speedRatio },
		}] });
		const source = generated(speedRatio === 2 ? 300 : 150);
		const regenerate = () => executeEditorCommand(history, { type: 'batch', commands: [
			createAddSourceCommand(source), createRegenerateTtsClipCommand('tts-clip', source.id),
		] });
		if (speedRatio === 0.5) assert.throws(regenerate, /overlap/u);
		else assert.equal(regenerate().present.clips.find(({ id }: { id: string }) => id === 'tts-clip')?.durationFrames, 150);
	}
});

test('regenerating looped speech retires the old source period and restores it with Undo', () => {
	const base = project();
	const initial = createCurrentAudioEditorProject({ ...base, clips: base.clips.map(clip => clip.id === 'tts-clip'
		? { ...clip, opaqueExtensions: { 'example.authoring': { retained: true } } } : clip) });
	const looped = executeEditorCommand(createEditorHistory(initial), { type: 'clip/update', clipId: 'tts-clip', changes: {
		loop: { periodFrames: 100, offsetFrames: 25, durationFrames: 200 },
	} }, { now: NOW });
	assert.deepEqual(readClipLoop(looped.present.clips.find((clip: { id: string }) => clip.id === 'tts-clip')!), { periodFrames: 100, offsetFrames: 25 });
	const source = generated(150);
	const replaced = executeEditorCommand(looped, { type: 'batch', commands: [
		createAddSourceCommand(source), createRegenerateTtsClipCommand('tts-clip', source.id),
	] }, { now: NOW });
	const clip = replaced.present.clips.find((clip: { id: string }) => clip.id === 'tts-clip')!;
	assert.equal(readClipLoop(clip), null, 'the full replacement voice plays once at its authored speed');
	assert.equal(clip.durationFrames, 150);
	assert.deepEqual(clip.opaqueExtensions, { 'example.authoring': { retained: true } });
	assert.deepEqual(undoEditorCommand(replaced, { now: NOW }).present.clips, looped.present.clips);
});
