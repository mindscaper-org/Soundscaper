/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseAdlTime, formatAdlTime } from '../src/common/editor/aes31-time.ts';
import { parseAdlDocument } from '../src/common/editor/aes31-import.ts';
import { createAdlExport } from '../src/common/editor/aes31-export.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';

const clock = { sampleRate: 48_000, rate: { num: 25, den: 1 }, dropFrame: false };
const adl = readFileSync(new URL('./fixtures/aes31/voice.adl', import.meta.url), 'utf8');

test('TCF preserves sample remainders, fractional sample/frame geometry and drop-frame labels', () => {
	assert.equal(parseAdlTime('00.00.01.00/0007', clock), 48_007);
	assert.equal(formatAdlTime(48_007, clock), '00.00.01.00/0007');
	const film = { ...clock, sampleRate: 44_100, rate: { num: 24, den: 1 } };
	assert.equal(parseAdlTime('00=00=00=02|0001', film), 3676);
	for (const setting of [clock, film, { ...clock, rate: { num: 30000, den: 1001 }, dropFrame: true }]) {
		for (const sample of [0, 1, 1837, 3675, 48_007, 2_882_880, 172_799_999]) {
			assert.equal(parseAdlTime(formatAdlTime(sample, setting), setting), sample);
		}
	}
	assert.throws(() => parseAdlTime('00:01:00,00/0000', { ...clock, rate: { num: 30000, den: 1001 }, dropFrame: true }), /label|timecode/iu);
	assert.throws(() => parseAdlTime('00.00.00.25/0000', clock));
	assert.throws(() => formatAdlTime(1, { ...clock, sampleRate: 96_000 }), /sample rate/iu);
});

test('external EDML rebases source/sequence origins and retains channel selection, fades and gain', () => {
	const document = parseAdlDocument(adl);
	assert.equal(document.title, 'Dialogue & atmosphere');
	assert.equal(document.startFrameCount, 90_000);
	assert.deepEqual(document.media[0]!.channelIndices, [1]);
	const clip = document.tracks[0]!.clips[0]!;
	assert.equal(clip.name, 'Phrase');
	let id = 0;
	const { project } = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++id}` });
	const clips = project.clips as Record<string, unknown>[];
	assert.equal(clips[0]!.timelineStartFrame, 7);
	assert.equal(clips[0]!.sourceStartFrame, 17);
	assert.equal(clips[0]!.durationFrames, 48_003);
	assert.equal(clips[0]!.fadeInFrames, 100);
	assert.ok(Math.abs(Number(clips[0]!.gain) - .5) < 1e-12);
});

test('malformed references, ranges, oversized documents and future ADL versions fail closed', () => {
	for (const broken of [adl.replace('(Cut) I 0001', '(Cut) I 0099'), adl.replace('2 3 10.', '2~3 3 10.'),
		adl.replace('01.00.01.00/0010', '00.00.00.00/0000'), adl.replace('01.01.00', '99.00.00'), adl.replace('"Phrase"', '"Phrase')]) {
		assert.throws(() => parseAdlDocument(broken));
	}
	assert.throws(() => parseAdlDocument(' '.repeat(32 * 1024 * 1024 + 1)), /limit/iu);
	const result = parseAdlDocument(adl.replace('</ADL>', '<FADER_LIST>(FP) 3 01.00.00.00/0000 -6</FADER_LIST></ADL>'));
	assert.ok(result.issues.some(item => item.code === 'adl.automation-omitted'));
});

test('ADL export keeps exact edits, splits overlaps and reports unsupported processing', () => {
	const project = { title: 'Voice', sampleRate: 48_000,
		sources: [{ id: 's', kind: 'audio', name: 'Private.mp3', storageKey: 'secret', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 }],
		tracks: [{ id: 't', type: 'audio', name: 'Dialogue', clipIds: ['a', 'b'], effects: [{ type: 'compressor', enabled: true }] }],
		clips: [{ id: 'a', kind: 'audio', sourceId: 's', title: 'First', timelineStartFrame: 7, durationFrames: 48_003, sourceStartFrame: 17, gain: .5, fadeInFrames: 100 },
			{ id: 'b', kind: 'audio', sourceId: 's', title: 'Second', timelineStartFrame: 20, durationFrames: 100, sourceStartFrame: 0 }],
	};
	const exported = createAdlExport({ project });
	assert.equal(exported.fileName, 'Voice.adl');
	assert.equal(exported.media.length, 1);
	assert.ok(!exported.text.includes('secret'));
	assert.ok(exported.report.items.some(item => item.code === 'adl.overlapping-track-split'));
	assert.ok(exported.report.items.some(item => item.code === 'adl.track-processing-omitted'));
	const document = parseAdlDocument(exported.text);
	assert.equal(document.tracks.length, 2);
	assert.equal(document.media[0]!.name, 'audio-0001.wav');
	assert.equal(document.tracks[0]!.clips[0]!.sourceStart.num / document.tracks[0]!.clips[0]!.sourceStart.den, 17 / 48_000);
});

test('ADL reports modern master processing and graph routing losses', () => {
	const result = createAdlExport({ project: { title: 'Mix', sampleRate: 48_000, tracks: [], clips: [], sources: [],
		master: { gain: .5, effects: [{ enabled: true, type: 'limiter' }] },
		mixer: { groups: [{ id: 'bus' }], sends: [], edges: [{ kind: 'assignment', level: .5 }] } } });
	assert.ok(result.report.items.some(item => item.code === 'adl.mix-processing-omitted'));
});
