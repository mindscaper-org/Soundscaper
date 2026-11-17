/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReaperDocument } from '../src/common/editor/reaper-import.ts';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { reaperSession } from './helpers/reaper-import-fixture.ts';

function imported(text = reaperSession()) {
	const document = parseTimelineInterchange('Podcast.RPP', text);
	let next = 0;
	const plan = buildTimelineInterchangeProject(document, { fileName: 'Podcast.RPP', createStableId: prefix => `${prefix}-${++next}` });
	return { document, plan, project: createCurrentAudioEditorProject(plan.project) };
}

test('RPP imports offline audio edits, source trims, item and take gain, track controls and markers', () => {
	const { document, project, plan } = imported();
	assert.equal(document.format, 'reaper');
	assert.equal(project.title, 'Podcast');
	assert.equal(project.sampleRate, 48000);
	assert.equal(project.clips.length, 1);
	const clip = project.clips[0]!;
	assert.equal(clip.title, 'Phrase');
	assert.equal(clip.timelineStartFrame, 24000);
	assert.equal(clip.sourceStartFrame, 12000);
	assert.equal(clip.durationFrames, 24000);
	assert.equal(clip.gain, 0.25);
	assert.equal(clip.fadeInFrames, 480);
	assert.equal(clip.fadeOutFrames, 960);
	assert.equal(project.tracks[0]!.name, 'Dialogue');
	assert.equal(project.tracks[0]!.gain, 0.5);
	assert.equal(project.tracks[0]!.pan, -0.5);
	assert.equal(project.master.gain, 0.75);
	assert.deepEqual(document.tempoMap?.events[0]?.bpm, { num: 100, den: 1 });
	assert.equal(project.timelineAnnotations[0]!.name, 'Cue');
	assert.equal(document.media[0]!.path, 'Audio Files/voice.wav');
	assert.ok(plan.report.items.some(item => item.code === 'reaper.media-missing'));
	assert.ok(plan.report.items.some(item => item.code === 'reaper.fade-curve-converted'));
});

test('active takes use their own source, offset and gain while retaining item placement and trim', () => {
	const text = reaperSession().replace('    >\n  >', `      TAKE SEL
      NAME "Selected take"
      TAKEVOLPAN 0 0.25 -1
      SOFFS 0.125
      PLAYRATE 1 1 0 -1
      <SOURCE FLAC
        FILE "other.flac"
      >
    >
  >`);
	const { document, project } = imported(text);
	assert.equal(project.clips[0]!.title, 'Selected take');
	assert.equal(project.clips[0]!.timelineStartFrame, 24000);
	assert.equal(project.clips[0]!.sourceStartFrame, 6000);
	assert.equal(project.clips[0]!.gain, 0.125);
	assert.equal(document.media[0]!.path, 'other.flac');
	assert.ok(document.issues.some(item => item.code === 'reaper.alternate-takes-omitted'));
});

test('RPP quoted strings preserve literal Windows paths, alternate quotes, Unicode, BOM and CRLF', () => {
	const text = '\uFEFF' + reaperSession().replace('"Dialogue"', "'Dialogue with \"quotes\"'")
		.replace('"Phrase"', '`Gruß \'voice\'`').replace('Audio Files/voice.wav', 'C:\\Music\\voice.wav').replaceAll('\n', '\r\n');
	const { document, project } = imported(text);
	assert.equal(project.tracks[0]!.name, 'Dialogue with "quotes"');
	assert.equal(project.clips[0]!.title, "Gruß 'voice'");
	assert.equal(document.media[0]!.path, 'C:\\Music\\voice.wav');
});

test('RPP media filenames retain literal hash, percent and question mark characters', () => {
	const { document } = imported(reaperSession().replace('voice.wav', 'voice%20#1?.wav'));
	assert.equal(document.media[0]!.name, 'voice%20#1?.wav');
});

test('repeated audio sources share one source, empty tracks survive and mute/solo are retained', () => {
	const text = reaperSession().replace('MUTESOLO 0 0 0', 'MUTESOLO 1 2 0').replace('MUTE 0 0', 'MUTE 1 0')
		.replace('    >\n  >', '    >\n    <ITEM\nPOSITION 2\nLENGTH 0.25\n<SOURCE WAVE\nFILE "Audio Files/voice.wav"\n>\n>\n  >')
		.replace(/>$/u, '<TRACK\nNAME Empty\n>\n>');
	const { document, project } = imported(text);
	assert.equal(document.media.length, 1);
	assert.equal(project.sources.length, 1);
	assert.equal(project.tracks.length, 2);
	assert.equal(project.tracks[0]!.mute, true);
	assert.equal(project.tracks[0]!.solo, true);
	assert.equal(project.clips[0]!.gain, 0);
	assert.equal(project.clips[1]!.timelineStartFrame, 96000);
});

test('sample clocks round once, scientific notation is accepted and an unspecified sample rate is reported', () => {
	const { project } = imported(reaperSession().replace('48000 1 0', '44100 1 0').replace('POSITION 0.5', 'POSITION 1e-3'));
	assert.equal(project.clips[0]!.timelineStartFrame, 44);
	assert.equal(project.clips[0]!.durationFrames, 22050);
	const { document } = imported(reaperSession().replace('SAMPLERATE 48000 1 0', 'SAMPLERATE 0 0 0'));
	assert.equal(document.sampleRate, 48000);
	assert.ok(document.issues.some(item => item.code === 'reaper.sample-rate-converted'));
});

test('inactive takes are ignored, take selection is unambiguous and raw notes are inert', () => {
	const text = reaperSession().replace('    >\n  >', 'TAKE\nNAME Inactive\n<SOURCE MIDI\nHASDATA 1 960 QN\n>\n    >\n  >')
		.replace('  <TRACK', '  <NOTES\n|Arbitrary unclosed " quote\n>\n  <TRACK');
	assert.equal(imported(text).project.clips[0]!.title, 'Phrase');
	assert.throws(() => parseReaperDocument(text.replace('TAKE\n', 'TAKE SEL\nTAKE SEL\n')), /active take/u);
});

test('non-unit rate, pitch shifts, reverse sections, channel remaps and all-takes playback are omitted explicitly', () => {
	for (const [before, after] of [
		['PLAYRATE 1 1 0', 'PLAYRATE 2 1 0'], ['PLAYRATE 1 1 0', 'PLAYRATE 1 1 3'],
		['SOURCE WAVE', 'SOURCE SECTION'], ['CHANMODE 0', 'CHANMODE 2'], ['ALLTAKES 0', 'ALLTAKES 1'],
		['SOFFS 0.25', 'SOFFS 0.25\nSM 0 0 0'],
	] as const) {
		const { document, project } = imported(reaperSession().replace(before, after));
		assert.equal(project.clips.length, 0, after);
		assert.ok(document.issues.some(item => item.disposition === 'omitted'), after);
	}
});

test('MIDI, video and generated sources are reported without inventing audio cuts', () => {
	for (const source of ['MIDI', 'VIDEO', 'CLICK', 'EMPTY']) {
		const { document } = imported(reaperSession().replace('SOURCE WAVE', `SOURCE ${source}`));
		assert.equal(document.tracks[0]!.clips.length, 0);
		assert.ok(document.issues.some(item => item.code === 'reaper.source-omitted'));
	}
});

test('processing, routing, envelopes, looping and pan differences are reported', () => {
	const text = reaperSession().replace('ISBUS 0 0', 'ISBUS 1 1\nAUXRECV 0 0 1 0 0 0')
		.replace('LOOP 0', 'LOOP 1').replace('    <ITEM', '    <FXCHAIN\n<VST "foreign"\nAAAA\n>\n>\n<VOLENV2\nPT 0 1 0\n>\n    <ITEM');
	const { document } = imported(text);
	for (const code of ['processing-omitted', 'routing-omitted', 'automation-omitted', 'looping-omitted', 'pan-law-converted']) {
		assert.ok(document.issues.some(item => item.code === `reaper.${code}`), code);
	}
});

test('RPP envelope attachment preferences alone do not imply omitted automation', () => {
	const { document } = imported(reaperSession().replace('  TEMPO ', '  ENVATTACH 1\n  TEMPOENVLOCKMODE 1\n  TEMPO '));
	assert.equal(document.issues.some(item => item.code === 'reaper.automation-omitted'), false);
});

test('overlapping cuts disclose additive playback and keep both edit boundaries', () => {
	const text = reaperSession().replace('    >\n  >', '    >\n<ITEM\nPOSITION 0.75\nLENGTH 1\n<SOURCE WAVE\nFILE "Audio Files/voice.wav"\n>\n>\n  >');
	const { document, project } = imported(text);
	assert.equal(project.clips.length, 2);
	assert.ok(document.issues.some(issue => issue.code === 'reaper.overlap-converted'));
});

test('RPP refuses malformed structure, duplicate controls, broken clocks and unbounded paths', () => {
	for (const text of ['<OTHER\n>', reaperSession().slice(0, -1), reaperSession() + '\n>',
		reaperSession() + '\n<REAPER_PROJECT\n>', reaperSession().replace('"Phrase"', '"unterminated'),
		reaperSession().replace('POSITION 0.5', 'POSITION NaN'), reaperSession().replace('LENGTH 0.5', 'LENGTH 0'),
		reaperSession().replace('SOFFS 0.25', 'SOFFS -1'), reaperSession().replace('VOLPAN 0.5 -0.5', 'VOLPAN Infinity -0.5'),
		reaperSession().replace('POSITION 0.5', 'POSITION 0.5\nPOSITION 1'),
		reaperSession().replace('Audio Files/voice.wav', 'x'.repeat(4097)),
		reaperSession().replace('PLAYRATE 1 0', 'PLAYRATE 2 0'),
	]) assert.throws(() => parseReaperDocument(text), text.slice(0, 70));
	assert.throws(() => parseReaperDocument('<REAPER_PROJECT\n' + '<NESTED\n'.repeat(65) + '>\n'.repeat(66)), /depth/iu);
	assert.throws(() => parseReaperDocument('<REAPER_PROJECT\n' + 'DATA 0\n'.repeat(100001) + '>'), /limit/iu);
});
