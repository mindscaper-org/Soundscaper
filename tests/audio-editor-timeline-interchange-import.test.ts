/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';

const rate = { num: 30000, den: 1001 };
function ids() { let next = 0; return (prefix: string) => `${prefix}-${++next}`; }
const audioProject = {
	title: 'Programme', sampleRate: 48000,
	sources: [{ id: 'sound', kind: 'audio', storageKey: 'media/sound.wav', name: 'sound.wav', sampleRate: 48000, frameCount: 200000, channelCount: 2 }],
	clips: [{ id: 'clip', kind: 'audio', sourceId: 'sound', timelineStartFrame: 48001, durationFrames: 24002, sourceStartFrame: 12003 }],
	tracks: [{ id: 'track', type: 'audio', name: 'Sound', clipIds: ['clip'] }],
};

test('OTIO import keeps exact sample placement and source trims with fractional sequence rate', () => {
	const exported = createOtioExport({ project: audioProject, sequenceRate: rate, dropFrame: true, startFrameCount: 107892 });
	const document = parseTimelineInterchange('programme.otio', exported.text);
	assert.deepEqual(document.rate, rate);
	assert.equal(document.startFrameCount, 107892);
	assert.equal(document.dropFrame, true);
	assert.deepEqual(document.tracks[0]?.clips[0]?.start, { num: 48001, den: 48000 });
	assert.deepEqual(document.tracks[0]?.clips[0]?.sourceStart, { num: 4001, den: 16000 });
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids(), media: new Map([['media/sound.wav', audioProject.sources[0]!]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.clips[0]?.timelineStartFrame, 48001);
	assert.equal(project.clips[0]?.durationFrames, 24002);
	assert.equal(project.clips[0]?.sourceStartFrame, 12003);
});

test('FCPXML import retains rational sequence origin and sample accurate connected audio', () => {
	const exported = createFcpxmlExport({ project: audioProject, sequenceRate: rate, dropFrame: true, startFrameCount: 107892 });
	const document = parseTimelineInterchange('programme.fcpxml', exported.text);
	assert.deepEqual(document.rate, rate);
	assert.equal(document.startFrameCount, 107892);
	assert.equal(document.dropFrame, true);
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids() });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.clips[0]?.timelineStartFrame, 48001);
	assert.equal(project.clips[0]?.durationFrames, 24002);
	assert.equal(project.clips[0]?.sourceStartFrame, 12003);
	assert.ok(plan.report.items.some(item => item.disposition === 'missing'));
});

test('EDL import reads reel comments, record origin and source trims on its declared rate', () => {
	const document = parseTimelineInterchange('cut.edl', 'TITLE: Cuts\nFCM: NON-DROP FRAME\n001 REEL V C 00:00:01:00 00:00:03:00 01:00:00:00 01:00:02:00\n* FROM CLIP NAME: camera.mov\n', { edlRate: { num: 25, den: 1 } });
	assert.equal(document.title, 'Cuts');
	assert.equal(document.startFrameCount, 90000);
	assert.equal(document.media[0]?.path, 'camera.mov');
	assert.deepEqual(document.tracks[0]?.clips[0]?.sourceStart, { num: 1, den: 1 });
	const project = createCurrentAudioEditorProject(buildTimelineInterchangeProject(document, { createStableId: ids() }).project);
	assert.equal(project.clips[0]?.sequenceStartFrame, 0);
	assert.equal(project.clips[0]?.sequenceFrameCount, 50);
	assert.equal(project.clips[0]?.sourceInFrame, 25);
});

test('EDL reports the absent rate and refuses malformed event records', () => {
	const document = parseTimelineInterchange('cut.edl', 'TITLE: Cuts\n001 AX A C 00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n');
	assert.ok(document.issues.some(item => item.code === 'edl.rate-assumed'));
	assert.throws(() => parseTimelineInterchange('cut.edl', '001 AX V C rubbish'), /event/iu);
});

test('OTIO nested untrimmed stacks preserve parallel and sequential origins and report unsupported effects', () => {
	const time = (value: number) => ({ OTIO_SCHEMA: 'RationalTime.1', value, rate: 25 });
	const clip = { OTIO_SCHEMA: 'Clip.2', name: 'Cut', source_range: { start_time: time(50), duration: time(25) }, media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'camera.mov' }, effects: [{ OTIO_SCHEMA: 'LinearTimeWarp.1', time_scalar: 2 }] };
	const document = parseTimelineInterchange('cut.otio', JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', tracks: { OTIO_SCHEMA: 'Stack.1', children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: [{ OTIO_SCHEMA: 'Gap.1', source_range: { start_time: time(0), duration: time(25) } }, { OTIO_SCHEMA: 'Stack.1', children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: [clip] }] }] }] } }));
	assert.deepEqual(document.tracks[0]?.clips[0]?.start, { num: 1, den: 1 });
	assert.ok(document.issues.some(item => item.code === 'otio.effects-omitted'));
});

test('FCPXML nested connected offsets use the parent source origin and reports time maps', () => {
	const xml = '<fcpxml version="1.10"><resources><format id="f" frameDuration="1/25s"/><asset id="a" name="Camera" hasVideo="1" start="10s"><media-rep src="camera.mov"/></asset><asset id="b" hasAudio="1"><media-rep src="sound.wav"/></asset></resources><project name="Cut"><sequence format="f" tcStart="3600s"><spine><asset-clip ref="a" offset="3602s" start="12s" duration="3s"><timeMap/><asset-clip ref="b" lane="-1" offset="13s" start="1s" duration="1s"/></asset-clip></spine></sequence></project></fcpxml>';
	const document = parseTimelineInterchange('cut.fcpxml', xml);
	assert.deepEqual(document.tracks.flatMap(track => track.clips).map(clip => clip.start), [{ num: 2, den: 1 }, { num: 3, den: 1 }]);
	assert.deepEqual(document.tracks.flatMap(track => track.clips).map(clip => clip.sourceStart), [{ num: 2, den: 1 }, { num: 1, den: 1 }]);
	assert.ok(document.issues.some(item => item.code === 'fcpxml.time-map-omitted'));
});

test('interchange parser rejects unrelated XML, unsafe rational times and excessive nesting', () => {
	assert.throws(() => parseTimelineInterchange('cut.fcpxml', '<unrelated/>'), /FCPXML/iu);
	assert.throws(() => parseTimelineInterchange('cut.fcpxml', '<fcpxml><project><sequence><spine><gap duration="1/0s"/></spine></sequence></project></fcpxml>'), /time|format/iu);
	let tracks: unknown = { OTIO_SCHEMA: 'Clip.1' };
	for (let i = 0; i < 70; i++) tracks = { OTIO_SCHEMA: 'Stack.1', children: [tracks] };
	assert.throws(() => parseTimelineInterchange('cut.otio', JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', tracks })), /depth/iu);
});

test('OTIO Clip.2 media references and source timecode origins map to native media zero', () => {
	const rt = (value: number) => ({ value, rate: 25 });
	const document = parseTimelineInterchange('cut.otio', JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', tracks: { OTIO_SCHEMA: 'Stack.1', children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: [{ OTIO_SCHEMA: 'Clip.2', source_range: { start_time: rt(90050), duration: rt(25) }, active_media_reference_key: 'camera', media_references: { camera: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'camera.mov', available_range: { start_time: rt(90000), duration: rt(250) } } } }] }] } }));
	assert.deepEqual(document.tracks[0]?.clips[0]?.sourceStart, { num: 2, den: 1 });
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids() });
	assert.ok(Object.isFrozen(plan.report));
	assert.ok(Object.isFrozen(plan.report.items));
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.clips[0]?.sourceInFrame, 50);
	assert.equal(project.sources[0]?.sourceFrameCount, 250);
});

test('OTIO trimmed nested containers clip both boundaries and advance source in-points', () => {
	const rt = (value: number) => ({ value, rate: 25 });
	const range = (start: number, duration: number) => ({ start_time: rt(start), duration: rt(duration) });
	const document = parseTimelineInterchange('cut.otio', JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', tracks: { OTIO_SCHEMA: 'Stack.1', source_range: range(25, 25), children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: [{ OTIO_SCHEMA: 'Clip.1', source_range: range(0, 100), media_reference: { target_url: 'camera.mov' } }] }] } }));
	const clip = document.tracks[0]?.clips[0];
	assert.deepEqual([clip?.start, clip?.duration, clip?.sourceStart], [{ num: 0, den: 1 }, { num: 1, den: 1 }, { num: 1, den: 1 }]);
});

test('interchange source trims respect decoded audio rate and source bounds', () => {
	const document = parseTimelineInterchange('cut.otio', createOtioExport({ project: audioProject, sequenceRate: rate }).text);
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids(), media: new Map([['media/sound.wav', { kind: 'audio', storageKey: 'decoded', sampleRate: 96000, frameCount: 36000, channelCount: 1 }]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.clips[0]?.sourceStartFrame, 24006);
	assert.equal(project.clips[0]?.sourceDurationFrames, 11994);
	assert.equal(project.clips[0]?.durationFrames, 5997);
	assert.ok(plan.report.items.some(item => item.code === 'otio.clip-source-extent-converted'));
});

test('FCPXML clip components inherit duration and disabled wrappers stay silent', () => {
	const xml = '<fcpxml version="1.10"><resources><format id="f" frameDuration="1/25s"/><asset id="a" name="Camera" hasVideo="1" start="10s"><media-rep src="file:///media/My%20Camera.mov"/></asset></resources><project><sequence format="f"><spine><clip offset="0s" start="0s" duration="2s"><video ref="a"/></clip><clip offset="2s" duration="2s" enabled="0"><video ref="a"/></clip></spine></sequence></project></fcpxml>';
	const document = parseTimelineInterchange('cut.fcpxml', xml);
	assert.equal(document.media[0]?.name, 'My Camera.mov');
	assert.equal(document.tracks[0]?.clips.length, 1);
	assert.deepEqual(document.tracks[0]?.clips[0]?.sourceStart, { num: 0, den: 1 });
	assert.deepEqual(document.tracks[0]?.clips[0]?.duration, { num: 2, den: 1 });
});

test('paired EDL A/V selectors retain source comments on both imported tracks', () => {
	const text = '* FPS: 25/1\n001 REEL AA/V C 00:00:01:00 00:00:02:00 01:00:00:00 01:00:01:00\n* FROM CLIP NAME: Opening\n* SOURCE FILE: camera.mov\n';
	const document = parseTimelineInterchange('cut.edl', text);
	assert.equal(document.tracks.length, 2);
	assert.deepEqual(document.media.map(item => item.path), ['camera.mov', 'camera.mov']);
});

test('EDL camera source timecode is rebased to the probed media origin before binding its trims', () => {
	const document = parseTimelineInterchange('camera.edl', '* FPS: 25/1\n001 CAMERA V C 01:00:01:00 01:00:02:00 01:00:00:00 01:00:01:00\n* SOURCE FILE: camera.mov\n');
	const mediaId = document.media[0]!.id;
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids(), media: new Map([[mediaId, {
		kind: 'video', id: 'camera', storageKey: 'camera', sampleRate: 48000, sampleFrameCount: 480000, sourceFrameCount: 250,
		width: 320, height: 180, frameRate: { num: 25, den: 1 }, characteristics: { startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0, dropFrame: false } },
	}]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.clips.length, 1);
	assert.equal(project.clips[0]?.sourceInFrame, 25);
});
