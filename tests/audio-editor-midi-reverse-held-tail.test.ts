/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
function rms(values: readonly number[]): number { return Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length); }
test('Reverse MIDI delivery refuses to silently drop a released pedal-held voice', async () => {
    const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'Held voice', durationFrames: 16000, notes: [{ id: 'held', pitch: 69, channel: 0, startFrame: 0, durationFrames: 4000, velocity: 100 }], events: [{ frame: 0, status: 176, data: [64, 127] }, { frame: 12000, status: 176, data: [64, 0] }] }] });
    const f = midiServiceFixture();
    await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
    const clip = f.project().clips[0];
    assert.ok(clip && typeof clip.durationFrames === 'number');
    f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
    assert.ok(validateAudioEditorProjectV17(f.project()));
    const original = f.pcm.get(clip.sourceId)?.flatMap(chunk => Array.from(chunk));
    assert.ok(original);
    const durationFrames = clip.durationFrames;
    const from = durationFrames - 10000, to = durationFrames - 8000;
    const expected = Array.from({ length: to - from }, (_, index) => original[durationFrames - 1 - (from + index)] ?? 0);
    assert.ok(rms(expected) > .05);
    for (const format of ['midi', 'allegro'] as const)
        await assert.rejects(f.service.exportFile(format), /Reversed MIDI pedal-held tails/u);
    assert.equal(f.saves.length, 0);
});
for (const window of [{ start: 0, frames: 4000, notes: 1 }, { start: 13000, frames: 3000, notes: 0 }])
    test(`Reverse remains available outside the held tail (${window.start}..${window.start + window.frames})`, async () => {
        const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'Held voice', durationFrames: 16000, notes: [{ id: 'held', pitch: 69, channel: 0, startFrame: 0, durationFrames: 4000, velocity: 100 }], events: [{ frame: 0, status: 176, data: [64, 127] }, { frame: 12000, status: 176, data: [64, 0] }] }] });
        const fixture = midiServiceFixture();
        await fixture.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
        const clip = fixture.project().clips[0];
        assert.ok(clip);
        await fixture.service.exportFile('midi');
        fixture.apply({ type: 'clip/trim', clipId: clip.id, timelineStartFrame: 0, sourceStartFrame: window.start, sourceDurationFrames: window.frames, durationFrames: window.frames });
        fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
        assert.ok(validateAudioEditorProjectV17(fixture.project()));
        await fixture.service.exportFile('midi');
        const saved = fixture.saves[1]?.bytes;
        assert.ok(saved instanceof Uint8Array);
        assert.equal(parseMidiFile(saved, { sampleRate: 8000 }).tracks.flatMap(track => track.notes).length, window.notes);
    });
