/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const note = { id: 'note', pitch: 60, startFrame: 0, durationFrames: 24_000, velocity: 100, channel: 0 };

function project() {
	return createAudioEditorProjectV17({
		sources: [createAudioSource({ id: 'fallback', frameCount: 96_000, channelCount: 1 })],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'fallback', durationFrames: 96_000, notes: [note],
			opaqueExtensions: { unrelated: { retained: true } } }) }],
		tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }) }],
	});
}

test('MIDI commands commit note data and its new PCM fallback together in one immutable batch', () => {
	const original = project();
	const changed = applyEditorCommand(original, { type: 'batch', commands: [
		{ type: 'source/add', source: createAudioSource({ id: 'next-fallback', frameCount: 120_000, channelCount: 1 }) },
		{ type: 'midi/clip-set', clipId: 'clip', data: { version: 1, notes: [{ ...note, pitch: 67 }] },
			sourceId: 'next-fallback', sourceDurationFrames: 120_000, durationFrames: 120_000 },
		{ type: 'midi/track-set', trackId: 'track', data: { version: 1, instrument: 'sine', program: 80 } },
	] });
	assert.equal(changed.revision, original.revision + 1);
	assert.equal(changed.clips[0]?.sourceId, 'next-fallback');
	assert.equal(changed.clips[0]?.durationFrames, 120_000);
	assert.equal(changed.clips[0]?.renderCacheRevision, 1);
	assert.equal(readMidiClip(changed.clips[0])?.notes[0]?.pitch, 67);
	assert.equal(readMidiTrack(changed.tracks[0])?.instrument, 'sine');
	assert.equal(original.clips[0]?.sourceId, 'fallback');
	assert.equal(readMidiClip(original.clips[0])?.notes[0]?.pitch, 60);
});

test('MIDI commands reject a locked owner, invalid data and invalid replacement sources atomically', () => {
	const original = project();
	for (const command of [
		{ type: 'midi/clip-set' as const, clipId: 'clip', data: { version: 1 as const, notes: [{ ...note, velocity: 200 }] }, sourceId: 'fallback', sourceDurationFrames: 96_000 },
		{ type: 'midi/clip-set' as const, clipId: 'clip', data: { version: 1 as const, notes: [note] }, sourceId: 'missing', sourceDurationFrames: 96_000 },
		{ type: 'midi/track-set' as const, trackId: 'missing', data: { version: 1 as const, instrument: 'sine' as const } },
	]) {
		assert.throws(() => applyEditorCommand(original, { type: 'batch', commands: [
			{ type: 'source/add', source: createAudioSource({ id: 'uncommitted', frameCount: 96_000, channelCount: 1 }) },
			command,
		] }));
		assert.equal(original.sources.length, 1);
		assert.equal(original.revision, 0);
	}
	const locked = applyEditorCommand(original, { type: 'track/update', trackId: 'track', changes: { locked: true } });
	assert.throws(() => applyEditorCommand(locked, { type: 'midi/track-set', trackId: 'track', data: { version: 1, instrument: 'square' } }), /locked/iu);
	assert.throws(() => applyEditorCommand(locked, { type: 'midi/clip-set', clipId: 'clip', data: { version: 1, notes: [] }, sourceId: 'fallback', sourceDurationFrames: 96_000 }), /locked/iu);
	assert.throws(() => applyEditorCommand(locked, { type: 'batch', commands: [
		{ type: 'track/update', trackId: 'track', changes: { locked: false } },
		{ type: 'midi/track-set', trackId: 'track', data: { version: 1, instrument: 'square' } },
	] }), /locked/iu);
});

test('MIDI commands do not retag ordinary audio or put note ranges beyond their fallback source', () => {
	const original = project();
	const ordinary = createAudioEditorProjectV17({ tracks: [createAudioTrack({ id: 'ordinary' })] });
	assert.throws(() => applyEditorCommand(ordinary, { type: 'midi/track-set', trackId: 'ordinary', data: { version: 1, instrument: 'square' } }), /MIDI/iu);
	assert.throws(() => applyEditorCommand(original, { type: 'midi/clip-set', clipId: 'clip',
		data: { version: 1, notes: [{ ...note, startFrame: 95_000 }] }, sourceId: 'fallback', sourceDurationFrames: 96_000 }), /fallback|source/iu);
});

test('destructive audio source replacement retires editable notes while preserving the resulting audio', () => {
	const original = project();
	const changed = applyEditorCommand(original, { type: 'batch', commands: [
		{ type: 'source/add', source: createAudioSource({ id: 'effect-result', frameCount: 96_000, channelCount: 1 }) },
		{ type: 'clip/replace-source', clipId: 'clip', sourceId: 'effect-result' },
	] });
	assert.equal(changed.clips[0]?.sourceId, 'effect-result');
	assert.equal(readMidiClip(changed.clips[0]), null);
	assert.deepEqual(changed.clips[0]?.opaqueExtensions.unrelated, { retained: true });
	assert.ok(readMidiTrack(changed.tracks[0]));
	assert.ok(readMidiClip(original.clips[0]));
	const processed = applyEditorCommand(original, { type: 'source/process-audio', sourceId: 'fallback',
		source: createAudioSource({ id: 'processed', frameCount: 96_000, channelCount: 1 }), startFrame: 0, endFrame: 96_000 });
	assert.equal(processed.clips[0]?.sourceId, 'processed');
	assert.equal(readMidiClip(processed.clips[0]), null);
	const renamed = applyEditorCommand(original, { type: 'source/update', sourceId: 'fallback', changes: { name: 'Renamed fallback' } });
	assert.ok(readMidiClip(renamed.clips[0]));
	const trimmed = applyEditorCommand(original, { type: 'clip/trim', clipId: 'clip', durationFrames: 48_000, sourceDurationFrames: 48_000 });
	assert.ok(readMidiClip(trimmed.clips[0]));
	const moved = applyEditorCommand(original, { type: 'project-bin/move-from-timeline', clipIds: ['clip'] });
	const binProcessed = applyEditorCommand(moved, { type: 'source/process-audio', sourceId: 'fallback',
		source: createAudioSource({ id: 'bin-processed', frameCount: 96_000, channelCount: 1 }), startFrame: 0, endFrame: 96_000 });
	assert.equal(readMidiClip(binProcessed.projectBin.clips[0]), null);
});

test('source-media trimming retires notes against discarded source samples without blocking the trim', () => {
	const source = createAudioSource({ id: 'fallback', frameCount: 96_000, channelCount: 1 });
	const clip = createMidiClip({ id: 'clip', sourceId: 'fallback', durationFrames: 48_000,
		notes: [{ ...note, startFrame: 72_000 }] });
	const original = createAudioEditorProjectV17({ sources: [source], clips: [{ ...clip }],
		tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }) }] });
	const trimmed = applyEditorCommand(original, { type: 'source/rewrite-media', sourceId: 'fallback',
		changes: { storageKey: 'trimmed-pcm', frameCount: 48_000 }, clips: [{ clipId: 'clip', sourceStartFrame: 0 }] });
	assert.equal(trimmed.sources[0]?.frameCount, 48_000);
	assert.equal(trimmed.clips[0]?.durationFrames, 48_000);
	assert.equal(readMidiClip(trimmed.clips[0]), null);
});
