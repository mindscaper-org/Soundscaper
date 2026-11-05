/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { midiClipOccurrences } from '../src/common/editor/midi-project-source-projection.ts';
import { midiProjectTiming } from '../src/common/editor/midi-project-timing.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
test('splitting a loop at a released note boundary does not resurrect that note in the right side', async () => {
    const f = midiServiceFixture();
    const part = await f.service.addTrack();
    await f.service.addNote(part.clipId, { id: 'voice', pitch: 60, startFrame: 0, durationFrames: 1001, velocity: 90, channel: 0 });
    const clip = f.project().clips[0];
    assert.ok(clip);
    assert.ok(typeof clip.durationFrames === 'number');
    const period = clip.durationFrames;
    f.apply({ type: 'clip/update', clipId: part.clipId, changes: { loop: { periodFrames: period, durationFrames: period * 2 } } });
    f.apply({ type: 'clip/split', clipId: part.clipId, atFrame: 1001, rightClipId: 'right' });
    assert.ok(validateAudioEditorProjectV17(f.project()));
    const right = f.project().clips.find(clip => clip.id === 'right');
    assert.ok(right);
    assert.deepEqual(readClipLoop(right), { periodFrames: period, offsetFrames: 1001 });
    await f.service.exportFile('midi');
    const bytes = f.saves[0]?.bytes;
    assert.ok(bytes instanceof Uint8Array);
    const output = parseMidiFile(bytes, { sampleRate: f.project().sampleRate });
    assert.deepEqual(output.tracks.flatMap(track => track.notes).map(note => [note.startFrame, note.durationFrames]), [[0, 1001], [period, 1001]]);
});
for (const geometry of [
    { rate: 8000, reverse: false, scale: 1, offset: 1001, cycles: 3, splitCycle: 1 },
    { rate: 8000, reverse: true, scale: 1, offset: 1001, cycles: 2, splitCycle: 0 },
    { rate: 48000, reverse: false, scale: 1, offset: 1565, cycles: 2, splitCycle: 0 },
    { rate: 44100, reverse: false, scale: 1, offset: 3381, cycles: 2, splitCycle: 0 },
    { rate: 8000, reverse: false, scale: 0.5, offset: 1001, cycles: 2, splitCycle: 0 },
])
    test(`Loop Split retains note count (${JSON.stringify(geometry)})`, async () => {
        const fixture = midiServiceFixture({ sampleRate: geometry.rate });
        const part = await fixture.service.addTrack();
        const sourceClip = fixture.project().clips[0];
        assert.ok(sourceClip && typeof sourceClip.durationFrames === 'number');
        const sourceFrames = sourceClip.durationFrames;
        const period = sourceFrames * geometry.scale;
        const keyFrames = geometry.offset / geometry.scale;
        await fixture.service.addNote(part.clipId, { id: 'voice', pitch: 60,
            startFrame: geometry.reverse ? sourceFrames - keyFrames : 0, durationFrames: keyFrames, velocity: 90, channel: 0 });
        fixture.apply({ type: 'clip/update', clipId: part.clipId, changes: { reversed: geometry.reverse, loop: { periodFrames: period, durationFrames: period * geometry.cycles } } });
        fixture.apply({ type: 'clip/split', clipId: part.clipId, atFrame: period * geometry.splitCycle + geometry.offset, rightClipId: 'right' });
        assert.ok(validateAudioEditorProjectV17(fixture.project()));
        await fixture.service.exportFile('midi');
        const bytes = fixture.saves[0]?.bytes;
        assert.ok(bytes instanceof Uint8Array);
        const notes = parseMidiFile(bytes, { sampleRate: geometry.rate }).tracks.flatMap(track => track.notes);
        const expected = Array.from({ length: geometry.cycles }, (_, cycle) => [cycle * period, geometry.offset]);
        assert.deepEqual(notes.map(note => [note.startFrame, note.durationFrames]), expected);
        await fixture.service.exportFile('allegro');
        assert.deepEqual(parseAllegroFile(String(fixture.saves[1]?.text), { sampleRate: geometry.rate }).tracks.flatMap(track => track.notes).map(note => [note.startFrame, note.durationFrames]), expected);
    });
test('a genuinely fractional source window retains its remaining key fragment', async () => {
    const fixture = midiServiceFixture();
    const part = await fixture.service.addTrack();
    const clip = fixture.project().clips[0];
    assert.ok(clip && typeof clip.durationFrames === 'number');
    const period = clip.durationFrames * 2;
    await fixture.service.addNote(part.clipId, { id: 'voice', pitch: 60, startFrame: 0, durationFrames: 501, velocity: 90, channel: 0 });
    fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { loop: { periodFrames: period, durationFrames: period * 2 } } });
    fixture.apply({ type: 'clip/split', clipId: clip.id, atFrame: 1001, rightClipId: 'right' });
    assert.ok(validateAudioEditorProjectV17(fixture.project()));
    await fixture.service.exportFile('midi');
    const bytes = fixture.saves[0]?.bytes;
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes).map(note => [note.startFrame, note.durationFrames]), [[0, 1001], [1001, 1], [period, 1002]]);
});
for (const frameCount of [100000000, 100000001])
    test(`large admitted loop geometry preserves its exact cut quotient (${frameCount})`, () => {
        let project = createAudioEditorProjectV17({ sampleRate: 8000,
            sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 8000, channelCount: 1, frameCount })],
            tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }, 8000) }],
            clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'source', durationFrames: frameCount, sourceDurationFrames: frameCount,
                    notes: [{ id: 'n', pitch: 60, startFrame: 0, durationFrames: 80000001, velocity: 90, channel: 0 }] }) }] });
        project = applyEditorCommand(project, { type: 'clip/update', clipId: 'clip', changes: { loop: { periodFrames: 150000000, durationFrames: 300000000 } } });
        project = applyEditorCommand(project, { type: 'clip/split', clipId: 'clip', atFrame: 120000000, rightClipId: 'right' });
        assert.ok(validateAudioEditorProjectV17(project));
        const right = project.clips.find(clip => clip.id === 'right');
        assert.ok(right);
        const first = midiClipOccurrences({ sampleRate: project.sampleRate, tempoMap: midiProjectTiming(project).tempoMap }, right).next().value;
        assert.ok(first);
        assert.equal(first.start, frameCount === 100000000 ? 80000000 : 80000000.8);
        assert.equal(first.global(first.start), 120000000);
    });
