/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { designSystemMidiClip } from '../src/common/editor/ui/workspace/midi-panel-projection.ts';
import type { EditorAudioClip } from '../src/common/editor/types.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const note = { id: 'n', pitch: 60, startFrame: 4000, durationFrames: 8000, velocity: 100, channel: 0 };
function fixture() {
	const source = createAudioSource({ id: 'native', sampleRate: 16000, frameCount: 16000, channelCount: 1 });
	const original = createAudioEditorProjectV17({ sampleRate: 16000, sources: [source],
		tracks: [{ ...createMidiTrack({ id: 'origin', clipIds: ['origin-clip'] }, 16000) }],
		clips: [{ ...createMidiClip({ id: 'origin-clip', sourceId: 'native', durationFrames: 16000, notes: [note] }) }] });
	const copied = createClipboardDescriptor(original, { startFrame: 0, endFrame: 16000, trackIds: ['origin'] });
	const f = midiServiceFixture({ sampleRate: 8000, sources: [source],
		tracks: [{ ...createAudioTrack({ id: 'track' }, 8000) }] });
	f.apply(preparePasteCommand(copied, { atFrame: 0, trackMap: { origin: 'track' }, mode: 'overlap' }, () => 'clip'));
	return f;
}

test('MIDI edits after cross-rate paste preserve the native source sample clock', async () => {
	const f = fixture();
	await f.service.updateNote('clip', 'n', { pitch: 67 });
	const clip = f.project().clips[0]!;
	const source = f.project().sources.find(source => source.id === clip.sourceId)!;
	assert.equal(source.sampleRate, 16000);
	assert.equal(clip.durationFrames, 8000);
	assert.equal(clip.sourceDurationFrames, 16000);
	assert.deepEqual(f.pcm.get(source.id)![0], renderMidiFrames([{ ...note, pitch: 67 }], 'triangle', 16000, 0, 16000));
	await f.service.setInstrument('track', 'square');
	const next = f.project().sources.find(source => source.id === f.project().clips[0]!.sourceId)!;
	assert.equal(next.sampleRate, 16000);
	assert.deepEqual(f.pcm.get(next.id)![0], renderMidiFrames(readMidiClip(f.project().clips[0])!.notes, 'square', 16000, 0, 16000));
});

test('piano-roll source note times use native samples while clip placement uses project samples', () => {
	const clip: EditorAudioClip = { kind: 'audio', id: 'clip', sourceId: 'native', title: 'Pasted',
		timelineStartFrame: 8000, durationFrames: 8000, sourceStartFrame: 4000, sourceDurationFrames: 16000 };
	const projected = designSystemMidiClip(clip, 8000, new Set(), [note], 16000);
	assert.equal(projected.start, 1);
	assert.equal(projected.duration, 1);
	assert.equal(projected.trimStart, 0.25);
	assert.equal(projected.notes[0]?.startTime, 0.25);
	assert.equal(projected.notes[0]?.duration, 0.5);
});
