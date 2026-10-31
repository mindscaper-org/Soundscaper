/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFcpxmlExport, frameTime } from '../src/common/editor/fcpxml-export.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';

function project(clip: Record<string, unknown> = {}, track: Record<string, unknown> = {}) {
	return {
		id: 'p', sampleRate: 48_000,
		sources: [{ id: 's', kind: 'audio', name: 'Source', sampleRate: 48_000, storageKey: 'media.wav' }],
		clips: [{ id: 'c', kind: 'audio', sourceId: 's', timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, ...clip }],
		tracks: [{ id: 't', type: 'audio', clipIds: ['c'], ...track }],
	};
}

test('I14: FCPXML frame rationals remain exact beyond Number multiplication precision', () => {
	assert.equal(frameTime(Number.MAX_SAFE_INTEGER, { num: 30_000, den: 1_001 }), '9016206453995731991/30000s');
});

test('I15: FCPXML attribute text preserves embedded tabs and line breaks', () => {
	const result = createFcpxmlExport({ project: project(), title: 'Line\nTab\tReturn\r', sequenceRate: { num: 25, den: 1 } });
	assert.match(result.text, /name="Line&#10;Tab&#9;Return&#13;"/u);
});

test('I16: FCPXML names dropped authored transitions in its delivery report', () => {
	const result = createFcpxmlExport({ project: project({ transition: 'crossfade' }), sequenceRate: { num: 25, den: 1 } });
	assert.ok(result.report.items.some(({ code }) => code === 'fcpxml.transition-omitted'));
});

test('I17: EDL source reels cannot be interpreted as black or test-pattern generators', async () => {
	const { createEdlExport } = await import('../src/common/editor/edl-export.ts');
	for (const reel of ['BL', 'BLACK', 'BARS']) {
		const result = createEdlExport({ title: 'Reel', rate: { num: 25, den: 1 }, events: [{
			reel, trackKind: 'V', sourceInFrames: 0, sourceOutFrames: 25, recordInFrames: 0, recordOutFrames: 25,
		}] });
		assert.doesNotMatch(result.text.split('\n')[2] ?? '', /^001\s+(?:BL|BLACK|BARS)\s/u);
		assert.ok(result.report.items.some(({ code }) => code === 'edl.reel-collision-resolved'));
	}
});

test('I18: dangling track clip references are reported by timeline exporters', () => {
	for (const [format, exportTimeline] of [['otio', createOtioExport], ['fcpxml', createFcpxmlExport]] as const) {
		const result = exportTimeline({ project: project({}, { clipIds: ['c', 'missing'] }), sequenceRate: { num: 25, den: 1 } });
		assert.ok(result.report.items.some(({ code }) => code === `${format}.clip-reference-missing`));
	}
});


test('I19: EDL title and clip-name comments cannot inject Unicode line separators', async () => {
	const { createEdlExport } = await import('../src/common/editor/edl-export.ts');
	const result = createEdlExport({ title: 'Title\u2028injected', rate: { num: 25, den: 1 }, events: [{
		reel: 'SOURCE', clipName: 'Clip\u2029injected', trackKind: 'V', sourceInFrames: 0, sourceOutFrames: 25, recordInFrames: 0, recordOutFrames: 25,
	}] });
	assert.doesNotMatch(result.text, /[\u2028\u2029]/u);
});

test('I22: FCPXML preserves native source trim times instead of rounding to the sequence grid', () => {
	const audio = createFcpxmlExport({ project: project({ sourceStartFrame: 1 }), sequenceRate: { num: 25, den: 1 } });
	assert.match(audio.text, /start="1\/48000s"/u);
	const picture = project({ kind: 'video', sourceInFrame: 1, sourceStartFrame: 1 }, { type: 'video' });
	const video = createFcpxmlExport({ project: { ...picture, sources: [{ id: 's', kind: 'video', frameRate: { num: 24, den: 1 } }] }, sequenceRate: { num: 25, den: 1 } });
	assert.match(video.text, /start="1\/24s"/u);
});

test('I23: EDL source timecode includes the camera media origin before its authored trim', async () => {
	const { createProjectEdlExport } = await import('../src/common/editor/edl-project-adapter.ts');
	const picture = project({ kind: 'video', sourceStartFrame: 48_000 }, { type: 'video' });
	const result = createProjectEdlExport({ project: { ...picture,
		primarySequenceId: 'main', sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 }, dropFrame: false, startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 } }],
		sources: [{ id: 's', kind: 'video', name: 'CAMERA', frameRate: { num: 25, den: 1 }, characteristics: {
			startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
		} }],
	} });
	assert.match(result.text, /01:00:01:00 01:00:02:00 00:00:00:00 00:00:01:00/u);
});

test('I24: FCPXML retains sample-accurate audio positions and sub-video-frame clips', () => {
	const result = createFcpxmlExport({ project: project({ timelineStartFrame: 1, durationFrames: 2 }), sequenceRate: { num: 25, den: 1 } });
	assert.match(result.text, /<asset-clip[^>]*offset="1\/48000s"[^>]*duration="1\/24000s"/u);
	assert.ok(!result.report.items.some(({ code }) => code === 'fcpxml.sub-frame-clip-omitted'));
});
