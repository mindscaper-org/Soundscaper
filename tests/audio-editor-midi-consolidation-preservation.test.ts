/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

test('lossless PCM consolidation preserves MIDI authoring on timeline and Project Bin clips', () => {
	const note = { id: 'note', pitch: 67, velocity: 90, channel: 0, startFrame: 1000, durationFrames: 2000 };
	const source = createAudioSource({ id: 'fallback', sampleRate: 8000, frameCount: 8000, channelCount: 1 });
	const clip = createMidiClip({ id: 'clip', sourceId: source.id, durationFrames: 8000, notes: [note] });
	const bin = createMidiClip({ id: 'bin', sourceId: source.id, durationFrames: 8000, notes: [note] });
	const original = createAudioEditorProjectV17({ sampleRate: 8000, sources: [source],
		tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }, 8000) }], clips: [{ ...clip }],
		projectBin: { clips: [{ ...bin }] } });
	// Consolidate media verifies identical decoded sample bits before producing this rewrite.
	const result = applyEditorCommand(original, { type: 'source/rewrite-media', sourceId: source.id,
		changes: { storageKey: 'verified-wavpack-copy' },
		clips: [{ clipId: 'clip', sourceStartFrame: 0 }, { clipId: 'bin', sourceStartFrame: 0 }] });
	assert.deepEqual(readMidiClip(result.clips[0])?.notes, [note]);
	assert.deepEqual(readMidiClip(result.projectBin.clips[0])?.notes, [note]);
	assert.equal(result.sources[0]?.storageKey, 'verified-wavpack-copy');
});
