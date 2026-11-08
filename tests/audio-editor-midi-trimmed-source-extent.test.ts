/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const action of ['note', 'instrument'] as const) test(`${action} editing a trimmed imported MIDI clip retains its hidden source ending`, async () => {
	const fixture = midiServiceFixture();
	const imported = await fixture.service.importDocument({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }],
		signatures: [{ frame: 0, numerator: 4, denominator: 4 }], tracks: [{ name: 'with trailing rest', durationFrames: 32000,
			notes: [{ id: 'note', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 }], events: [] }] });
	const created = imported[0]!;
	assert.ok(created.trackId);
	fixture.apply({ type: 'clip/trim', clipId: created.clipId, timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 8000, durationFrames: 8000 });
	const before = fixture.project().clips[0]!;
	assert.equal(fixture.project().sources.find(source => source.id === before.sourceId)?.frameCount, 32000);
	if (action === 'note') await fixture.service.updateNote(created.clipId, 'note', { pitch: 67 });
	else await fixture.service.setInstrument(created.trackId, 'sine');
	const clip = fixture.project().clips[0]!;
	assert.equal(clip.durationFrames, 8000);
	assert.equal(clip.sourceDurationFrames, 8000);
	assert.equal(fixture.project().sources.find(source => source.id === clip.sourceId)?.frameCount, 32000,
		'the Source Editor and ordinary timeline untrim must still expose the imported hidden rest');
});
