/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createDeliveryReportForPlan, countUnreportedDeliveryConversions } from '../src/common/editor/delivery-conversion-inventory.ts';
import { parseIxmlPayload } from '../src/common/editor/ixml.ts';

async function recordingProject() {
	// Python48kHz stereo PCM; unmodified BWF MetaEdit26.08.1 --in-iXML
	// embeds standard Gallery Mid/Side track functions and recorder inputs4/6.
	const encoded = await readFile(new URL('./fixtures/bwfmetaedit-mid-side.wav.base64', import.meta.url), 'utf8');
	const input = new File([Buffer.from(encoded.trim(), 'base64')], 'Mid-side.wav', { type: 'audio/wav' });
	const descriptor = await inspectWavBlobPcm(input);
	assert.equal(descriptor.channelCount, 2); assert.equal(descriptor.frameCount, 4800); assert.ok(descriptor.ixml);
	return createSoundscaperProject({ sampleRate: 48_000, masterChannels: 2,
		sources: [{ id: 'source', name: input.name, channelCount: 2, frameCount: 4800, sampleRate: 48_000, sampleFormat: 'float32', storageKey: 'source' }],
		clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0, timelineStartFrame: 0, durationFrames: 4800 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Recorder', clipIds: ['clip'] }], metadata: { ixml: descriptor.ixml } });
}

for (const channelMapping of ['mono', [{ inputs: [{ channel: 1, gain: 1 }] }, { inputs: [{ channel: 0, gain: 1 }] }]]) {
	test(`BWF ${typeof channelMapping === 'string' ? 'mono' : 'swapped channels'} delivery omits inaccurate recorder track labels and reports the loss`, async () => {
		const project = await recordingProject();
		const original = structuredClone(project.metadata.ixml);
		const plan = createExportPlan(project, { format: 'bwf', channelMapping, bitDepth: 16 });
		assert.ok(plan.ixml);
		assert.deepEqual(plan.ixml.tracks, []);
		assert.doesNotMatch(plan.ixml.rawXml, /<TRACK_LIST>|M-MID_SIDE|S-MID_SIDE/u);
		assert.equal(plan.ixml.project, 'Coastal documentary');
		assert.equal(plan.ixml.note, 'Mid-side location take');
		assert.match(plan.ixml.rawXml, /<FILE_SAMPLE_RATE>48000<\/FILE_SAMPLE_RATE>/u);
		const report = createDeliveryReportForPlan(plan, { sampleRate: 48_000 });
		const omission = report.items.find(item => item.code === 'delivery.ixml-tracks-omitted');
		assert.ok(omission); assert.equal(omission.disposition, 'omitted'); assert.equal(omission.severity, 'warning');
		assert.equal(omission.data.tracks, 2);
		assert.equal(countUnreportedDeliveryConversions(plan, { sampleRate: 48_000 }, report), 0);
		assert.deepEqual(project.metadata.ixml, original, 'native recorder metadata stays available unchanged');
	});
}

for (const channelMapping of ['preserve', 'stereo', [
	{ inputs: [{ channel: 0, gain: 0.5 }, { channel: 1, gain: 0 }] }, { inputs: [{ channel: 1, gain: 2 }] },
]]) test(`BWF ${typeof channelMapping === 'string' ? channelMapping : 'same-channel gain'} keeps recorder identity and verbatim XML`, async () => {
	const project = await recordingProject();
	const plan = createExportPlan(project, { format: 'bwf', channelMapping, bitDepth: 16 });
	assert.equal(plan.ixml?.rawXml, project.metadata.ixml?.rawXml);
	assert.deepEqual(plan.ixml?.tracks.map(track => track.channelIndex), [4, 6], 'recorder inputs are not output channel indices');
	assert.equal(createDeliveryReportForPlan(plan, { sampleRate: 48_000 }).items.some(item => item.code === 'delivery.ixml-tracks-omitted'), false);
});

test('mono export preserves unrelated vendor track lists, comments, sync points and recorder timing', async () => {
	const project = await recordingProject();
	const original = project.metadata.ixml; assert.ok(original);
	const xml = original.rawXml.replace('</BWFXML>', '<VENDOR><TRACK_LIST><TRACK><NAME>Private alias</NAME></TRACK></TRACK_LIST></VENDOR>'
		+ '<SYNC_POINT_LIST><SYNC_POINT><SYNC_POINT_TYPE>RELATIVE</SYNC_POINT_TYPE><SYNC_POINT_LOW>2400</SYNC_POINT_LOW><SYNC_POINT_HIGH>0</SYNC_POINT_HIGH></SYNC_POINT></SYNC_POINT_LIST>'
		+ '<!--Keep TRACK_LIST comment--><TAPE><![CDATA[Recorder take]]></TAPE></BWFXML>');
	const withVendor = createSoundscaperProject({ ...project, metadata: { ixml: parseIxmlPayload(new TextEncoder().encode(xml)) } });
	const plan = createExportPlan(withVendor, { format: 'bwf', channelMapping: 'mono', sampleRate: 96_000, bitDepth: 24 });
	assert.ok(plan.ixml);
	assert.match(plan.ixml.rawXml, /<VENDOR><TRACK_LIST><TRACK><NAME>Private alias<\/NAME><\/TRACK><\/TRACK_LIST><\/VENDOR>/u);
	assert.match(plan.ixml.rawXml, /<!--Keep TRACK_LIST comment-->/u);
	assert.match(plan.ixml.rawXml, /<TAPE><!\[CDATA\[Recorder take\]\]><\/TAPE>/u);
	assert.deepEqual(plan.ixml.tracks, []);
	assert.equal(plan.ixml.syncPoints[0]?.sampleCount, '4800');
	assert.match(plan.ixml.rawXml, /<FILE_SAMPLE_RATE>96000<\/FILE_SAMPLE_RATE>/u);
	assert.match(plan.ixml.rawXml, /<AUDIO_BIT_DEPTH>24<\/AUDIO_BIT_DEPTH>/u);
});

test('ordinary recordings without recorder track labels create no new omission warning', async () => {
	const project = await recordingProject();
	const withoutTracks = createSoundscaperProject({ ...project, metadata: { ixml: { note: 'Unlabelled recorder take' } } });
	const plan = createExportPlan(withoutTracks, { format: 'bwf', channelMapping: 'mono' });
	assert.equal(plan.ixml?.note, 'Unlabelled recorder take');
	assert.equal(createDeliveryReportForPlan(plan, { sampleRate: 48_000 }).items.some(item => item.code === 'delivery.ixml-tracks-omitted'), false);
});
