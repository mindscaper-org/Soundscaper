/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const initialBpm of [120, 90]) for (const offsetFrames of [0, 8000]) for (const partialTail of [false, true]) {
	test(`looped MIDI restores its source conductor at ${initialBpm} BPM with offset ${offsetFrames} and partial tail ${partialTail}`, async () => {
		const f = await fixture(initialBpm, true);
		const clip = f.project().clips[0]!;
		assert.equal(clip.kind, 'audio');
		if (clip.kind !== 'audio') return;
		const restart = 64_000 - offsetFrames;
		f.apply({ type: 'clip/update', clipId: clip.id, changes: { loop: {
			periodFrames: 32_000, durationFrames: partialTail ? restart + 3000 : 96_000, offsetFrames,
		} } });
		const document = parseMidiFile(writeMidiFile(midiDocumentFromProject(f.project())), { sampleRate: 8000 });
		assert.equal(at(document.tempos, restart + 2000)?.bpm, f.project().tempo.bpm);
		assert.deepEqual(at(document.signatures, restart + 2000), {
			frame: restart, numerator: 5, denominator: 8, clocksPerMetronomeClick: 17, notated32ndNotesPerQuarter: 16,
		});
		if (!partialTail) assert.equal(at(document.tempos, restart + 6000)?.bpm, 60);
	});
}

test('constant-clock MIDI repeats retain their compact conductor and note delivery', async () => {
	const f = await fixture(120, false);
	const clip = f.project().clips[0]!;
	if (clip.kind !== 'audio') throw new TypeError('Expected the imported MIDI audio fallback.');
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { loop: {
		periodFrames: 32_000, durationFrames: 320_000,
	} } });
	const document = parseMidiFile(writeMidiFile(midiDocumentFromProject(f.project())), { sampleRate: 8000 });
	assert.equal(document.tempos.length, 1);
	assert.equal(document.signatures.length, 1);
	assert.equal(document.tracks.reduce((count, track) => count + track.notes.length, 0), 20);
});

function at<Value extends Readonly<{ frame: number }>>(events: readonly Value[], frame: number): Value | undefined {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]!;
		if (event.frame <= frame) return event;
	}
	return undefined;
}

async function fixture(bpm: number, changes: boolean) {
	const f = midiServiceFixture();
	const document = parseMidiFile(writeMidiFile({ sampleRate: 8000,
		tempos: [{ frame: 0, bpm }, ...(changes ? [{ frame: 4000, bpm: 60 }] : [])],
		signatures: [{ frame: 0, numerator: 5, denominator: 8, clocksPerMetronomeClick: 17, notated32ndNotesPerQuarter: 16 },
			...(changes ? [{ frame: 4000, numerator: 3, denominator: 4 }] : [])],
		tracks: [{ name: 'Clock loop', durationFrames: 32_000, notes: [
			{ id: 'a', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 2000 },
			{ id: 'b', pitch: 64, channel: 0, velocity: 90, startFrame: 24_000, durationFrames: 2000 },
		] }],
	}), { sampleRate: 8000 });
	await f.service.importDocument(document);
	return f;
}
