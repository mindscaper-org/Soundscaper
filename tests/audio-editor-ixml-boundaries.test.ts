/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { parseIxmlPayload } from '../src/common/editor/ixml.ts';
import { ixmlAtImportOrigin, ixmlForDeliveryRange } from '../src/common/editor/ixml-delivery-timing.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

function metadata(position = 48_000, duration?: number) {
	return parseIxmlPayload(new TextEncoder().encode('<BWFXML><SYNC_POINT_LIST><SYNC_POINT_COUNT>1</SYNC_POINT_COUNT><SYNC_POINT>'
		+ '<SYNC_POINT_TYPE>RELATIVE</SYNC_POINT_TYPE><SYNC_POINT_FUNCTION>SLATE_GENERIC</SYNC_POINT_FUNCTION>'
		+ `<SYNC_POINT_LOW>${position}</SYNC_POINT_LOW><SYNC_POINT_HIGH>0</SYNC_POINT_HIGH>`
		+ (duration === undefined ? '' : `<SYNC_POINT_EVENT_DURATION>${duration}</SYNC_POINT_EVENT_DURATION>`)
		+ '</SYNC_POINT></SYNC_POINT_LIST></BWFXML>'));
}

test('selected BWF exports omit recorder points exactly at the exclusive range end', () => {
	const project = createSoundscaperProject({ sampleRate: 48_000,
		sources: [{ id: 'source', kind: 'audio', name: 'Recorder', sampleRate: 48_000, frameCount: 96_000, channelCount: 1, sampleFormat: 'float32', storageKey: 'source' }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', sourceStartFrame: 0, timelineStartFrame: 0, durationFrames: 96_000 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Recorder', clipIds: ['clip'] }], metadata: { ixml: metadata() } });
	const first = createExportPlan(project, { format: 'bwf', range: { startFrame: 0, endFrame: 48_000 } });
	const second = createExportPlan(project, { format: 'bwf', range: { startFrame: 48_000, endFrame: 96_000 } });
	assert.deepEqual(first.ixml?.syncPoints, []);
	assert.equal(second.ixml?.syncPoints[0]?.sampleCount, '0');
});

test('adjacent mastering regions emit one copy of a recorder point on their shared boundary', () => {
	const delivered = ixmlForDeliveryRange(metadata(), { startFrame: 0, endFrame: 96_000 }, 48_000, 48_000, 24, {
		sequenceId: 'sequence', totalFrames: 96_000, segments: [0, 48_000].map((start, index) => ({
			entryId: String(index), annotationId: String(index), title: 'Region', gapBeforeFrames: 0,
			sourceStartFrame: start, sourceEndFrame: start + 48_000, outputStartFrame: start, outputEndFrame: start + 48_000,
			fadeInFrames: 0, fadeOutFrames: 0, metadata: {},
		})),
	});
	assert.equal(delivered?.syncPoints.length, 1);
	assert.equal(delivered?.syncPoints[0]?.sampleCount, '48000');
});

test('resampled recorder event durations use converted endpoints at import and selected delivery', () => {
	const source = metadata(48_001, 24_006);
	const imported = ixmlAtImportOrigin(source, 48_000, 44_100, 1000);
	assert.equal(imported.syncPoints[0]?.sampleCount, '45101');
	assert.match(imported.rawXml, /<SYNC_POINT_EVENT_DURATION>22055<\/SYNC_POINT_EVENT_DURATION>/u);
	const delivered = ixmlForDeliveryRange(source, { startFrame: 24_000, endFrame: 96_000 }, 48_000, 44_100, 24)!;
	assert.equal(delivered.syncPoints[0]?.sampleCount, '22051');
	assert.match(delivered.rawXml, /<SYNC_POINT_EVENT_DURATION>22055<\/SYNC_POINT_EVENT_DURATION>/u);
	assert.match(source.rawXml, /<SYNC_POINT_EVENT_DURATION>24006<\/SYNC_POINT_EVENT_DURATION>/u);
});

test('ordinary WAV import keeps vendor extension fields separate from recorder metadata and records', async () => {
	const point = (position: number) => '<SYNC_POINT><SYNC_POINT_TYPE>RELATIVE</SYNC_POINT_TYPE>'
		+ `<SYNC_POINT_LOW>${position}</SYNC_POINT_LOW><SYNC_POINT_HIGH>0</SYNC_POINT_HIGH></SYNC_POINT>`;
	const xml = '<BWFXML><VENDOR_PRIVATE><PROJECT>Backup project</PROJECT><SCENE>Preview scene</SCENE>'
		+ '<TRACK_LIST><TRACK><CHANNEL_INDEX>99</CHANNEL_INDEX><NAME>Private track</NAME></TRACK></TRACK_LIST>'
		+ `<SYNC_POINT_LIST>${point(99)}</SYNC_POINT_LIST></VENDOR_PRIVATE>`
		+ '<PROJECT>Recorded project</PROJECT><SCENE>Scene 12</SCENE><TRACK_LIST><TRACK><CHANNEL_INDEX>1</CHANNEL_INDEX>'
		+ '<VENDOR_PRIVATE><NAME>Private alias</NAME></VENDOR_PRIVATE><NAME>Boom</NAME></TRACK></TRACK_LIST>'
		+ `<SYNC_POINT_LIST><SYNC_POINT_COUNT>1</SYNC_POINT_COUNT>${point(240)}</SYNC_POINT_LIST></BWFXML>`;
	const wav = encodeWav([new Float32Array(480)], { sampleRate: 48_000, ixml: { rawXml: xml } });
	const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(wav)]));
	assert.equal(descriptor.ixml?.project, 'Recorded project');
	assert.equal(descriptor.ixml?.scene, 'Scene 12');
	assert.deepEqual(descriptor.ixml?.tracks, [{ channelIndex: 1, name: 'Boom', function: '' }]);
	assert.deepEqual(descriptor.ixml?.syncPoints.map(point => point.sampleCount), ['240']);
	assert.equal(descriptor.ixml?.rawXml, xml);
});
