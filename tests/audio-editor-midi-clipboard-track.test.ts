/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

test('copying MIDI into another project retains an instrument owner and editable notes', () => {
	const source = createAudioSource({ id: 'source', frameCount: 48_000, channelCount: 1 });
	const original = createAudioEditorProjectV17({ id: 'origin', sources: [source],
		tracks: [{ ...createMidiTrack({ id: 'midi', instrument: 'sawtooth', program: 81, clipIds: ['clip'] }) }],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'source', durationFrames: 48_000, notes: [
			{ id: 'n', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 24_000 },
		], opaqueExtensions: { unrelated: 'preserved' } }) }],
	});
	const copied = createClipboardDescriptor(original, { startFrame: 0, endFrame: 48_000, trackIds: ['midi'] });
	const clipboard = JSON.parse(JSON.stringify(copied)) as typeof copied;
	const destination = createAudioEditorProjectV17({ id: 'destination', sources: [source],
		tracks: [{ ...createAudioTrack({ id: 'target', opaqueExtensions: { own: true } }) }] });
	let counter = 0;
	const pasted = applyEditorCommand(destination, preparePasteCommand(clipboard,
		{ atFrame: 0, trackMap: { midi: 'target' }, mode: 'overlap' }, () => `pasted-${++counter}`));
	assert.deepEqual(readMidiTrack(pasted.tracks[0]), { version: 1, instrument: 'sawtooth', program: 81 });
	assert.equal(pasted.tracks[0]?.opaqueExtensions.own, true);
	assert.equal(readMidiClip(pasted.clips[0])?.notes[0]?.pitch, 60);
	assert.equal(pasted.clips[0]?.opaqueExtensions.unrelated, 'preserved');
	assert.deepEqual(Object.keys(pasted.clips[0]!.opaqueExtensions).sort(), ['soundscaper.midi', 'unrelated']);
	assert.ok(midiDocumentFromProject(pasted).tracks.some(track => track.notes.length === 1));
	assert.equal(readMidiTrack(destination.tracks[0]), null);
	const edited = applyEditorCommand(pasted, { type: 'midi/clip-set', clipId: pasted.clips[0]!.id, sourceId: 'source',
		sourceDurationFrames: 48_000, data: { version: 1, notes: [] } });
	assert.equal(readMidiClip(edited.clips[0])?.notes.length, 0);
});
