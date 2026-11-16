/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { ardourSession, soundcraftSession } from './helpers/native-daw-import-fixtures.ts';

function project(fileName: string, text: string) {
	let next = 0;
	const document = parseTimelineInterchange(fileName, text);
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++next}` });
	return { document, plan, project: createCurrentAudioEditorProject(plan.project) };
}

for (const modern of [false, true]) test(`Ardour ${modern ? 'superclock' : 'sample'} timing imports only the active audio playlist`, () => {
	const result = project('voice.ardour', ardourSession(modern));
	assert.equal(result.project.title, 'Native session');
	assert.equal(result.project.sampleRate, 48000);
	assert.equal(result.project.clips.length, 1);
	const clip = result.project.clips[0]!;
	assert.equal(clip.timelineStartFrame, 24000);
	assert.equal(clip.durationFrames, 24000);
	assert.equal(clip.sourceStartFrame, 12000);
	assert.equal(clip.gain, 0.75);
	assert.equal(result.project.tracks[0]!.name, 'Dialogue');
	assert.equal(result.project.tracks[0]!.gain, 0.5);
	assert.equal(result.project.tracks[0]!.pan, -0.5);
	assert.equal(result.project.tracks[0]!.solo, true);
	assert.equal(result.document.media[0]!.path, 'interchange/Native session/audiofiles/voice.wav');
	assert.ok(result.plan.report.items.some(item => item.code === 'ardour.media-missing'));
});

test('SoundCraft v1 retains active playlist, sample offsets, mix controls and fade lengths', () => {
	const result = project('voice.SCRAFT', JSON.stringify(soundcraftSession()));
	assert.equal(result.project.clips.length, 1);
	const clip = result.project.clips[0]!;
	assert.equal(clip.timelineStartFrame, 24000);
	assert.equal(clip.durationFrames, 24000);
	assert.equal(clip.sourceStartFrame, 12000);
	assert.equal(clip.fadeInFrames, 240);
	assert.equal(clip.fadeOutFrames, 480);
	assert.ok(Math.abs(clip.gain - 10 ** (-3 / 20)) < 1e-6);
	assert.ok(Math.abs(Number(result.project.tracks[0]!.gain) - 10 ** (-6 / 20)) < 1e-6);
	assert.equal(result.project.tracks[0]!.pan, -0.5);
	assert.equal(result.project.tracks[0]!.solo, true);
	assert.deepEqual(result.document.rate, { num: 25, den: 1 });
	assert.ok(result.plan.report.items.some(item => item.code === 'soundcraft.fade-curve-converted'));
});

test('SoundCraft rejects unknown versions, unsafe samples, duplicate sources and invalid active playlists', () => {
	const read = (value: unknown) => parseTimelineInterchange('voice.scraft', JSON.stringify(value));
	const session = soundcraftSession();
	assert.throws(() => read({ ...session, format_version: 2 }), /version/iu);
	assert.throws(() => read({ ...session, sources: [...session.sources, ...session.sources] }), /duplicate/iu);
	session.tracks[0]!.active_playlist = 9;
	assert.throws(() => read(session), /playlist/iu);
	session.tracks[0]!.active_playlist = 1;
	session.tracks[0]!.playlists[1]!.clips[0]!.start = Number.MAX_SAFE_INTEGER + 1;
	assert.throws(() => read(session), /safe|sample/iu);
});

test('Ardour refuses unsafe XML and beat positions that require a tempo conversion', () => {
	assert.throws(() => parseTimelineInterchange('voice.ardour', '<!DOCTYPE Session SYSTEM "file:///etc/passwd"><Session/>'), /doctype|declaration/iu);
	assert.throws(() => parseTimelineInterchange('voice.ardour', ardourSession().replace('position="24000"', 'position="b1920"')), /beat|tempo/iu);
	assert.throws(() => parseTimelineInterchange('voice.ardour', ardourSession().replace('source-0="10"', 'source-0="missing"')), /source/iu);
});

test('Ardour split stereo preserves both source files on left and right tracks', () => {
	const xml = ardourSession().replace('</Sources>', '<Source id="11" name="voice-R.wav" type="audio" channel="0"/></Sources>')
		.replace('source-0="10" channels="1"', 'source-0="10" source-1="11" channels="2"');
	const result = project('voice.ardour', xml);
	assert.equal(result.project.clips.length, 2);
	assert.equal(result.project.sources.length, 2);
	assert.deepEqual(result.project.tracks.map(track => track.pan), [-1, 1]);
	assert.deepEqual(result.project.clips.map(clip => clip.timelineStartFrame), [24000, 24000]);
	assert.ok(result.plan.report.items.some(item => item.code === 'ardour.split-stereo-converted'));
});

test('Ardour interleaved stereo references share a single source and clip', () => {
	const xml = ardourSession().replace('</Sources>', '<Source id="11" name="voice.wav" type="audio" channel="1"/></Sources>')
		.replace('source-0="10" channels="1"', 'source-0="10" source-1="11" channels="2"');
	const result = project('voice.ardour', xml);
	assert.equal(result.project.clips.length, 1);
	assert.equal(result.project.sources.length, 1);
});

test('Ardour missing playlist IDs and malformed superclock durations are refused', () => {
	assert.throws(() => project('voice.ardour', ardourSession().replace('audio-playlist="30"', 'audio-playlist="999"')), /playlist/iu);
	assert.throws(() => project('voice.ardour', ardourSession(true).replace('a141120000@a141120000', 'a141120000@broken')), /time/iu);
});

test('legacy Ardour diskstream playlists use IO identity and sample trims', () => {
	const xml = '<Session version="2.0.0" name="Legacy" sample-rate="44100"><Sources><Source id="1" name="voice.wav" channel="0"/></Sources>'
		+ '<DiskStreams><AudioDiskstream id="3" playlist="Voice"/></DiskStreams><Routes><Route diskstream-id="3" muted="no" soloed="yes">'
		+ '<IO id="2" name="Voice" gain="0.5"><Panner><StreamPanner x="0.25"/></Panner></IO></Route></Routes><Playlists><Playlist name="Voice">'
		+ '<Region id="4" name="Legacy phrase" source-0="1" start="11025" position="22050" length="22050" scale-gain="0.25"/>'
		+ '</Playlist></Playlists></Session>';
	const result = project('voice.ardour', xml);
	assert.equal(result.project.clips[0]!.timelineStartFrame, 22050);
	assert.equal(result.project.clips[0]!.sourceStartFrame, 11025);
	assert.equal(result.project.clips[0]!.gain, 0.25);
	assert.equal(result.project.tracks[0]!.name, 'Voice');
	assert.equal(result.project.tracks[0]!.pan, -0.5);
	assert.equal(result.project.tracks[0]!.solo, true);
});

test('Ardour channel remapping is refused before decoding can play the wrong channel', () => {
	assert.throws(() => project('voice.ardour', ardourSession().replace('channel="0"', 'channel="1"')), /channel/iu);
});

test('legacy Ardour empty diskstream playlists remain empty tracks', () => {
	const xml = '<Session version="2.0.0" sample-rate="44100"><DiskStreams><AudioDiskstream id="3" playlist="Empty"/></DiskStreams>'
		+ '<Routes><Route diskstream-id="3"><IO id="2" name="Empty"/></Route></Routes><Playlists/></Session>';
	const result = project('empty.ardour', xml);
	assert.equal(result.project.tracks.length, 1);
	assert.equal(result.project.clips.length, 0);
});

test('Ardour overlapping layers remain cuts with a reported mixing limitation', () => {
	const xml = ardourSession().replace('</Playlist>', '<Region id="41" source-0="10" position="24000" start="0" length="12000"/></Playlist>');
	const result = project('overlap.ardour', xml);
	assert.equal(result.project.clips.length, 2);
	assert.ok(result.plan.report.items.some(item => item.code === 'ardour.layering-omitted'));
});

test('SoundCraft omitted processing and automation are reported while muted clips stay silent', () => {
	const session = soundcraftSession() as Record<string, unknown>;
	const tracks = session.tracks as Record<string, unknown>[];
	const track = tracks[0]!;
	track.automation = [{}];
	track.mixer = { ...(track.mixer as object), inserts: [{ plugin: 'eq7' }], mute: true };
	const playlists = track.playlists as { clips: Record<string, unknown>[] }[];
	playlists[1]!.clips[0]!.muted = true;
	session.markers = [{ name: 'Verse' }];
	const result = project('voice.scraft', JSON.stringify(session));
	assert.equal(result.project.clips[0]!.gain, 0);
	assert.equal(result.project.tracks[0]!.mute, true);
	for (const code of ['soundcraft.effect-state-preserved', 'soundcraft.markers-omitted']) {
		assert.ok(result.plan.report.items.some(item => item.code === code));
	}
});

test('SoundCraft gain limiting is reported and decoded source rate controls trim frames', () => {
	const session = soundcraftSession();
	session.tracks[0]!.mixer.volume_db = 60;
	const document = parseTimelineInterchange('voice.scraft', JSON.stringify(session));
	let next = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++next}`,
		media: new Map([['10', { kind: 'audio', sampleRate: 96000, frameCount: 96000, channelCount: 1 }]]) });
	const imported = createCurrentAudioEditorProject(plan.project);
	assert.equal(imported.clips[0]!.sourceStartFrame, 24000);
	assert.equal(imported.clips[0]!.durationFrames, 24000);
	assert.equal(imported.tracks[0]!.gain, 4);
	assert.ok(plan.report.items.some(item => item.code === 'soundcraft.gain-clamped'));
});

test('SoundCraft refuses excessive nesting even in ignored fields', () => {
	let nested: unknown = {};
	for (let index = 0; index < 70; index++) nested = { nested };
	assert.throws(() => parseTimelineInterchange('voice.scraft', JSON.stringify({ ...soundcraftSession(), nested })), /depth/iu);
});
