/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiClip, readMidiTrack, removeMidiClipData } from '../src/common/editor/midi-model.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function fixture() {
	return createAudioEditorProjectV17({
		sources: [createAudioSource({ id: 'source', frameCount: 96_000, channelCount: 1 })],
		tracks: [{ ...createMidiTrack({ id: 'midi', instrument: 'square', program: 80, clipIds: ['clip'] }) },
			{ ...createAudioTrack({ id: 'audio', opaqueExtensions: { unrelated: { kept: true } } }) }],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'source', durationFrames: 96_000, notes: [
			{ id: 'note', pitch: 60, startFrame: 0, durationFrames: 24_000, velocity: 90, channel: 0 },
		] }) }],
	});
}

for (const command of [
	{ type: 'clip/move', clipId: 'clip', trackId: 'audio', timelineStartFrame: 0 },
	{ type: 'clip/transform-many', transforms: [{ clipId: 'clip', trackId: 'audio', changes: { timelineStartFrame: 0 } }] },
] satisfies AudioEditorCommand[]) {
	test(`${command.type}: moving a MIDI clip to an ordinary audio track preserves editing and export`, () => {
		const original = fixture();
		const moved = applyEditorCommand(original, command);
		const destination = moved.tracks.find(track => track.id === 'audio')!;
		assert.deepEqual(readMidiTrack(destination), { version: 1, instrument: 'square', program: 80 });
		assert.deepEqual(destination.opaqueExtensions.unrelated, { kept: true });
		assert.ok(midiDocumentFromProject(moved).tracks.some(track => track.notes.length === 1));
		const edited = applyEditorCommand(moved, { type: 'midi/clip-set', clipId: 'clip', sourceId: 'source',
			sourceDurationFrames: 96_000, data: { version: 1, notes: [{ ...readMidiClip(moved.clips[0])!.notes[0]!, pitch: 67 }] } });
		assert.equal(readMidiClip(edited.clips[0])?.notes[0]?.pitch, 67);
		assert.equal(readMidiTrack(original.tracks[1]), null);
	});
}

test('moving a clip preserves an existing target instrument and leaves ordinary audio untagged', () => {
	const original = fixture();
	const targetMidi = createAudioEditorProjectV17({ ...original, tracks: [original.tracks[0]!,
		{ ...createMidiTrack({ id: 'audio', instrument: 'sine' }) }] });
	const move = { type: 'clip/move', clipId: 'clip', trackId: 'audio', timelineStartFrame: 0 } as const;
	assert.equal(readMidiTrack(applyEditorCommand(targetMidi, move).tracks[1])?.instrument, 'sine');
	const ordinary = createAudioEditorProjectV17({ ...original, clips: [removeMidiClipData(original.clips[0]!)] });
	assert.equal(readMidiTrack(applyEditorCommand(ordinary, move).tracks[1]), null);
});
