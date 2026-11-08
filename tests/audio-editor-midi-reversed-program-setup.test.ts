/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
test('reversing an imported instrument part retains its source ProgramChange before notes', async () => {
    const events = [0, 0xc2, 40, 0, 0x92, 60, 90, 0x83, 0x60, 0x82, 60, 0, 0, 255, 47, 0];
    const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
    const original = parseMidiFile(await new File([bytes], 'Violin.mid').arrayBuffer(), { sampleRate: 8000 });
    const f = midiServiceFixture();
    await f.service.importDocument(original);
    const clip = f.project().clips[0];
    assert.ok(clip);
    f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
    await f.service.exportFile('midi');
    const output = f.saves[0]?.bytes;
    assert.ok(output instanceof Uint8Array);
    const track = parseMidiFile(output, { sampleRate: 8000 }).tracks.find(track => track.notes.length);
    assert.ok(track);
    const program = track.events?.find(event => event.status === 0xc2);
    assert.ok(program);
    assert.equal(program.data[0], 40);
    assert.ok(program.frame <= track.notes[0]!.startFrame, `ProgramChange at${program.frame}, firstNoteOn at${track.notes[0]!.startFrame}`);
});
for (const status of [0xc2, 0xb2])
    test(`reversed changing setup ${status} is refused before delivery`, async () => {
        const change = status === 0xc2 ? [status, 41] : [status, 0, 1];
        const events = [0, 0xc2, 40, 0, 0x92, 60, 90, 0x81, 0x70, ...change, 0x81, 0x70, 0x82, 60, 0, 0, 255, 47, 0];
        const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
        const fixture = midiServiceFixture();
        await fixture.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
        const clip = fixture.project().clips[0];
        assert.ok(clip);
        fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
        await assert.rejects(fixture.service.exportFile('midi'), /Reversed MIDI device, program, or bank changes/u);
        assert.equal(fixture.saves.length, 0);
        fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: false } });
        await fixture.service.exportFile('midi');
        assert.equal(fixture.saves.length, 1);
    });

for (const status of [0xc2, 0xb2]) test(`ported constant setup ${status} is refused only for reversed delivery`, async () => {
    const setup = status === 0xc2 ? [status, 40] : [status, 0, 1];
    // A valid trackwide FF21 precedes every channel message in this source.
    const events = [0, 255, 0x21, 1, 1, 0, ...setup, 0, 0x92, 60, 90, 0x83, 0x60, 0x82, 60, 0, 0, 255, 47, 0];
    const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
    const fixture = midiServiceFixture();
    await fixture.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
    const clip = fixture.project().clips[0]; assert.ok(clip);
    fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
    await assert.rejects(fixture.service.exportFile('midi'), /Reversed MIDI port-aware program or bank setup/u);
    assert.equal(fixture.saves.length, 0);
    fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: false } });
    await fixture.service.exportFile('midi');
    const saved = fixture.saves[0]?.bytes; assert.ok(saved instanceof Uint8Array);
    const track = parseMidiFile(saved, { sampleRate: 8000 }).tracks.find(track => track.notes.length); assert.ok(track);
    let port = 0;
    for (const event of track.events ?? []) {
        if (event.status === 255 && event.metaType === 0x21) port = event.data[0]!;
        if (event.status === status) { assert.equal(port, 1); break; }
    }
    assert.ok(track.events?.some(event => event.status === status));
    assert.ok(typeof clip.durationFrames === 'number');
    fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { loop: { periodFrames: clip.durationFrames, durationFrames: clip.durationFrames * 2 } } });
    await fixture.service.exportFile('midi');
    const repeated = fixture.saves[1]?.bytes; assert.ok(repeated instanceof Uint8Array);
    assert.equal(parseMidiFile(repeated, { sampleRate: 8000 }).tracks.flatMap(track => track.notes).length, 2);
});
