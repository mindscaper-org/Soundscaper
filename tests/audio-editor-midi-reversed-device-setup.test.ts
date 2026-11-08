/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
test('reversing a MIDI clip retains the original trackwide device before its notes', async () => {
    const events = [0, 255, 9, 5, 83, 121, 110, 116, 104, 0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0, 0, 255, 47, 0];
    const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
    const file = new File([bytes], 'Named device.mid');
    const original = parseMidiFile(await file.arrayBuffer(), { sampleRate: 8000 });
    assert.deepEqual(original.tracks[0]?.noteDestinations, [{ channel: 0, port: 0, device: [83, 121, 110, 116, 104] }]);
    const f = midiServiceFixture();
    await f.service.importDocument(original);
    const clip = f.project().clips[0];
    assert.ok(clip);
    f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
    await f.service.exportFile('midi');
    const output = f.saves[0]?.bytes;
    assert.ok(output instanceof Uint8Array);
    const reopened = parseMidiFile(output, { sampleRate: 8000 });
    assert.deepEqual(reopened.tracks.find(track => track.notes.length)?.noteDestinations, [{ channel: 0, port: 0, device: [83, 121, 110, 116, 104] }]);
});
