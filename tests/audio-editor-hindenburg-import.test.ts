/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHindenburgDocument } from '../src/common/editor/hindenburg-import.ts';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { hindenburgSession } from './helpers/hindenburg-import-fixture.ts';

function imported(xml = hindenburgSession()) {
	const document = parseTimelineInterchange('Podcast.NHSX', xml);
	let next = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++next}` });
	return { document, plan, project: createCurrentAudioEditorProject(plan.project) };
}

test('NHSX retains track order, exact stored clocks, source trims, levels and offline edits', () => {
	const { document, plan, project } = imported();
	assert.equal(document.format, 'hindenburg');
	assert.equal(project.title, 'Podcast edit');
	assert.equal(project.sampleRate, 48000);
	assert.equal(project.clips.length, 1);
	const clip = project.clips[0]!;
	assert.equal(clip.timelineStartFrame, 24000);
	assert.equal(clip.durationFrames, 24000);
	assert.equal(clip.sourceStartFrame, 12000);
	assert.equal(clip.gain, 0.5); // ClipGain wins over Gain.
	assert.equal(clip.fadeInFrames, 480);
	assert.equal(clip.fadeOutFrames, 960);
	assert.equal(project.tracks[0]!.name, 'Dialogue');
	assert.equal(project.tracks[0]!.gain, 0.5);
	assert.equal(project.tracks[0]!.pan, -0.5);
	assert.equal(document.media[0]!.path, 'Podcast Files/voice.wav');
	assert.ok(plan.report.items.some(item => item.code === 'hindenburg.media-missing'));
	assert.ok(plan.report.items.some(item => item.code === 'hindenburg.pan-law-converted'));
	assert.ok(plan.report.items.some(item => item.code === 'hindenburg.fade-curve-converted'));
});

test('omitted zero attributes, namespaced elements, long clocks and repeated sources are accepted', () => {
	const xml = hindenburgSession().replace('<Session ', '<Session xmlns="urn:hindenburg" ')
		.replace('Start="00.500"', 'Start="01:04:00.473"').replace(' Offset="00.250"', '')
		.replace('</Track>', '<Region Ref="1" Length="0.250"/></Track>');
	const { document, project } = imported(xml);
	assert.deepEqual(document.tracks[0]!.clips[0]!.start, { num: 3840473, den: 1000 });
	assert.deepEqual(project.clips.map(clip => clip.sourceStartFrame), [0, 0]);
	assert.deepEqual(project.clips.map(clip => clip.timelineStartFrame), [184342704, 0]);
	assert.equal(project.sources.length, 1);
	const prefixed = xml.replace(/<(\/?)(Session|Info|AudioPool|File|MetaData|Tracks|Track|Region|Clipboard|Group)(?=[\s/>])/gu, '<$1h:$2')
		.replace('xmlns="urn:hindenburg"', 'xmlns:h="urn:hindenburg"');
	assert.equal(imported(prefixed).project.clips.length, 2);
	assert.equal(imported(xml.replace('<Region ', '<Region xmlns="urn:hindenburg" ')).project.clips.length, 2);
});

test('44.1 kHz clocks round once to the project grid and session Time does not trim the edit', () => {
	const { project } = imported(hindenburgSession().replace('Samplerate="48000"', 'Samplerate="44100"')
		.replace('Start="00.500"', 'Start="00.001"'));
	assert.equal(project.clips[0]!.timelineStartFrame, 44);
	assert.equal(project.clips[0]!.durationFrames, 22050);
});

test('legacy track Gain and boolean spellings preserve mute and solo without losing clips', () => {
	const xml = hindenburgSession().replace('Volume=', 'Gain=').replace('Pan="0.5"', 'Muted="True" Solo="1"')
		.replace('Ref="1" Name=', 'Ref="1" Muted="true" Name=');
	const { project } = imported(xml);
	assert.equal(project.tracks[0]!.gain, 0.5);
	assert.equal(project.tracks[0]!.mute, true);
	assert.equal(project.tracks[0]!.solo, true);
	assert.equal(project.clips[0]!.gain, 0);
});

test('metadata, ducking, plug-ins, markers, clipboards and Narrator authoring losses are reported', () => {
	const xml = hindenburgSession().replace('<Info Title=', '<Info Author="Reporter" Title=')
		.replace('<MetaData ', '<Transcription><p><w s="0.2" l="0.1">Hello</w></p></Transcription><MetaData ')
		.replace('FadeOut="00.020"/>', 'FadeOut="00.020"><Fade Start="0.1" Length="0.2" Gain="-10"/></Region>')
		.replace('</Track>', '<Plugins><Plugin Name="Voice Profiler"/></Plugins></Track>')
		.replace('<Group/>', '<Group><Region Ref="1" Length="1"/></Group>')
		.replace('</Session>', '<Markers><Marker Id="1" Name="Chapter" Time="0.5"/></Markers><Document File="book.epub"/><NavPoints><NavPoint Begin="0" End="1"/></NavPoints><FutureState/></Session>');
	const { document } = imported(xml);
	for (const code of ['metadata-omitted', 'transcription-omitted', 'ducking-omitted', 'processing-omitted',
		'clipboard-omitted', 'markers-omitted', 'document-omitted', 'unknown-element-omitted']) {
		assert.ok(document.issues.some(item => item.code === `hindenburg.${code}`), code);
	}
	assert.equal(document.tracks[0]!.clips.length, 1);
});

test('unsupported compound and transformed regions are reported rather than played as plain cuts', () => {
	for (const region of ['<Region Name="Compound" Length="1"><Region Ref="1" Length="1"/></Region>',
		'<Region Ref="1" Length="1" Speed="2"/>']) {
		const { document, project } = imported(hindenburgSession().replace(/<Region[^>]+\/>/u, region));
		assert.equal(project.clips.length, 0);
		assert.ok(document.issues.some(item => item.code === 'hindenburg.region-omitted'));
	}
});

test('empty pools, empty tracks and omitted AudioPool Path are supported', () => {
	const document = parseHindenburgDocument('<Session Samplerate="48000"><AudioPool/><Tracks><Track Name="Empty"/></Tracks></Session>');
	assert.equal(document.tracks.length, 1);
	assert.equal(document.media.length, 0);
	assert.equal(imported(hindenburgSession().replace('Path="Podcast Files"', 'Path=""')).document.media[0]!.path, 'voice.wav');
});

test('legacy names, file-relative paths and explicit gain limits retain useful audio controls', () => {
	const xml = hindenburgSession().replace('<Info Title="Podcast edit"/>', '')
		.replace('<Session ', '<Session Name="Legacy title" ')
		.replace('Path="Podcast Files"', 'Path="Podcast\\Files"')
		.replace('Name="voice.wav" Duration=', 'Name="voice.wav" Path="Media\\voice.wav" Duration=')
		.replace('Volume="-6.020599913279624"', 'Volume="60" Gain="-3"')
		.replace('Pan="0.5"', 'Pan="3"')
		.replace('ClipGain="-6.020599913279624"', 'ClipGain="60"');
	const { document, project, plan } = imported(xml);
	assert.equal(project.title, 'Legacy title');
	assert.equal(document.media[0]!.path, 'Podcast/Files/Media/voice.wav');
	assert.equal(project.tracks[0]!.gain, 4);
	assert.equal(project.tracks[0]!.pan, -1);
	assert.equal(project.clips[0]!.gain, 16);
	assert.ok(plan.report.items.some(item => item.code === 'hindenburg.gain-clamped'));
	assert.ok(plan.report.items.some(item => item.code === 'hindenburg.track-gain-omitted'));
	assert.equal(imported(hindenburgSession().replace('ClipGain="-6.020599913279624"', 'ClipGain="-inf"')).project.clips[0]!.gain, 0);
});

test('source and session controls, track processing and unsupported track kinds are disclosed', () => {
	const xml = hindenburgSession().replace('Version=', 'MasterVolume="-3" Version=')
		.replace('Name="voice.wav" Duration=', 'Name="voice.wav" Speed="2" Duration=')
		.replace('Name="Dialogue"', 'Name="Dialogue" Bus="Master"')
		.replace('</Tracks>', '<Track Name="Video" Type="Video"><Region Ref="1" Length="1"/></Track></Tracks>');
	const { document } = imported(xml);
	assert.equal(document.tracks.length, 1);
	for (const code of ['source-controls-omitted', 'session-controls-omitted', 'track-controls-omitted', 'track-omitted']) {
		assert.ok(document.issues.some(issue => issue.code === `hindenburg.${code}`));
	}
});

test('NHSX refuses broken references, duplicate IDs, invalid structure, clocks and controls', () => {
	for (const [before, after] of [
		['Ref="1"', 'Ref="missing"'], ['<Tracks>', '<AudioPool/><Tracks>'],
		['Samplerate="48000"', 'Samplerate="0"'], ['Start="00.500"', 'Start="1:2:3:4"'],
		['Start="00.500"', 'Start="00:60.000"'], ['Offset="00.250"', 'Offset="-1"'],
		['Length="00.500"', 'Length="0"'], ['Length="00.500"', 'Length="NaN"'],
		['Pan="0.5"', 'Pan="NaN"'], ['Volume="-6.020599913279624"', 'Volume="Infinity"'],
		['ClipGain="-6.020599913279624"', 'ClipGain="9999"'], ['Start="00.500"', 'Start="9007199254740992"'],
		['FadeIn="00.010"', 'FadeIn="bad"'], ['<Track Name=', '<Track Muted="perhaps" Name='],
		['</AudioPool>', '<File Id="1" Name="duplicate.wav"/></AudioPool>'],
	] as const) assert.throws(() => parseHindenburgDocument(hindenburgSession().replace(before, after)), `${before} -> ${after}`);
	assert.throws(() => parseHindenburgDocument('<Ardour/>'), /Session/u);
	assert.throws(() => parseHindenburgDocument('<Session Samplerate="48000"><AudioPool/></Session>'), /Tracks/u);
});

test('unsafe media paths, DTD entities, excessive nesting and item counts are refused', () => {
	for (const path of ['../escape', '/outside', 'C:\\outside', 'https://example.com/media']) {
		assert.throws(() => parseHindenburgDocument(hindenburgSession().replace('Path="Podcast Files"', `Path="${path}"`)), /path/iu);
	}
	assert.throws(() => parseHindenburgDocument(hindenburgSession().replace('Name="voice.wav"', 'Name="../voice.wav"')), /path/iu);
	assert.throws(() => parseHindenburgDocument('<!DOCTYPE Session SYSTEM "file:///etc/passwd"><Session/>'), /doctype|declaration/iu);
	assert.throws(() => parseHindenburgDocument('<!DOCTYPE Session [<!ENTITY x "boom">]><Session/>'), /doctype|declaration/iu);
	assert.throws(() => parseHindenburgDocument('<Session>' + '<a>'.repeat(65) + '</a>'.repeat(65) + '</Session>'), /nest|depth/iu);
	assert.throws(() => parseHindenburgDocument('<Session>' + '<a/>'.repeat(100001) + '</Session>'), /elements|limit/iu);
});
