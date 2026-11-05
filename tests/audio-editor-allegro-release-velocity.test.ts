/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
for (const velocity of [0, 81])
    test(`Allegro delivery truthfully handles imported release velocity ${velocity}`, async () => {
        const events = [0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, velocity, 0, 255, 47, 0];
        const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
        const document = parseMidiFile(bytes, { sampleRate: 8000 });
        const fixture = midiServiceFixture();
        await fixture.service.importDocument(document);
        if (velocity) {
            await assert.rejects(fixture.service.exportFile('allegro'), /Allegro cannot preserve MIDI release velocity/u);
            assert.equal(fixture.saves.length, 0);
            await fixture.service.exportFile('midi');
            const saved = fixture.saves[0]?.bytes;
            assert.ok(saved instanceof Uint8Array);
            assert.equal(parseMidiFile(saved, { sampleRate: 8000 }).tracks.flatMap(track => track.notes)[0]?.releaseVelocity, velocity);
        }
        else {
            await fixture.service.exportFile('allegro');
            const text = fixture.saves[0]?.text;
            assert.equal(typeof text, 'string');
            assert.equal(parseAllegroFile(String(text), { sampleRate: 8000 }).tracks.flatMap(track => track.notes)[0]?.releaseVelocity, undefined);
        }
    });
