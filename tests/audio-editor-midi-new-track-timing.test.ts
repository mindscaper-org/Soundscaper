/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('a new four-measure MIDI clip follows tempo changes within those measures', async () => {
	const f = midiServiceFixture({ tempoMap: { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		{ beat: { num: 8, den: 1 }, bpm: { num: 60, den: 1 } },
	] } });
	await f.service.addTrack();
	assert.equal(f.project().clips[0]?.durationFrames, 96000);
});

test('a new four-measure MIDI clip follows signature changes within those measures', async () => {
	const f = midiServiceFixture({ signatureMap: { events: [
		{ bar: 0, numerator: 4, denominator: 4 }, { bar: 2, numerator: 3, denominator: 4 },
	] } });
	await f.service.addTrack();
	assert.equal(f.project().clips[0]?.durationFrames, 56000);
});
