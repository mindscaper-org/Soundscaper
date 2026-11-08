/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { reportInterchangeMidiConversion } from '../src/common/editor/interchange-midi-report.ts';
import { withMidiTrackData, withMidiClipData } from '../src/common/editor/midi-model.ts';

function report(format: string) { return sealDeliveryReport(createDeliveryReport({ format, container: format, codec: null,
	sampleRate: 48000, channelCount: null, lossless: null })); }
function fixture() {
	return { tracks: [withMidiTrackData({ id: 't', type: 'audio', clipIds: ['c'] }, { version: 1, instrument: 'sine', program: 5 })],
		clips: [withMidiClipData({ id: 'c', kind: 'audio' }, { version: 1,
			notes: [{ id: 'n', pitch: 60, channel: 0, startFrame: 0, durationFrames: 4800, velocity: 100 }] })] };
}
for (const format of ['otio', 'fcpxml', 'omf']) test(`${format} describes the audible MIDI fallback and editable-data conversion`, () => {
	const result = reportInterchangeMidiConversion(report(format), fixture());
	const item = result.items.find(entry => entry.code === `${format}.midi-authoring-converted`);
	assert.equal(item?.disposition, 'converted');
	assert.equal(item?.data?.notes, 1);
	assert.equal(item?.data?.program, 5);
	assert.match(item?.message ?? '', /audio fallback/u);
});
test('EDL names MIDI authoring omitted with its audio track', () => {
	const draft = createDeliveryReport({ format: 'edl', container: 'edl', codec: null, sampleRate: 48000, channelCount: null, lossless: null });
	addDeliveryReportItem(draft, { code: 'edl.audio-track-omitted', disposition: 'omitted', severity: 'warning',
		scope: { kind: 'track', id: 't' }, message: 'Another track is selected.' });
	const result = reportInterchangeMidiConversion(sealDeliveryReport(draft), fixture());
	assert.equal(result.items.find(item => item.code === 'edl.midi-authoring-converted')?.disposition, 'omitted');
});
test('ordinary audio and an unrelated export keep the original report identity', () => {
	const before = report('otio');
	assert.equal(reportInterchangeMidiConversion(before, { tracks: [{ id: 't', type: 'audio', clipIds: [] }] }), before);
	const native = report('dawproject');
	assert.equal(reportInterchangeMidiConversion(native, fixture()), native);
});
test('inaudible MIDI tracks have no conversion warning', () => {
	const project = fixture();
	project.tracks = project.tracks.map(track => ({ ...track, mute: true }));
	const result = reportInterchangeMidiConversion(report('otio'), project);
	assert.equal(result.items.length, 0);
});


test('EDL selected audio tracks report the MIDI fallback as converted', () => {
	const result = reportInterchangeMidiConversion(report('edl'), fixture());
	assert.equal(result.items[0]?.disposition, 'converted');
	assert.match(result.items[0]?.message ?? '', /audio fallback/u);
});
