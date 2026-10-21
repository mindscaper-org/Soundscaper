/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAudioEditorLabels, serializeWebVttLabels } from '../src/common/editor/label-io.js';
import { parseAudioEditorCueSheet } from '../src/common/editor/cue-import.ts';
import { importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

const identity = { sampleRate: 48_000, trackId: 'captions', sequenceId: 'main', trackName: 'Captions', language: 'en' };
const timing = '00:00:00,000 --> 00:00:01,000';
const vttTiming = '00:00.000 --> 00:01.000';

function caption(text: string, format: 'srt' | 'webvtt' = 'srt') {
	return importVideoCaptionTrackV1(text, { ...identity, format });
}

function utf16(text: string): Uint8Array {
	const data = new Uint8Array(2 + text.length * 2);
	data.set([0xff, 0xfe]);
	const view = new DataView(data.buffer);
	for (let index = 0; index < text.length; index += 1) view.setUint16(2 + index * 2, text.charCodeAt(index), true);
	return data;
}

test('I01: numeric two-column point label titles remain text', () => {
	const result = parseAudioEditorLabels('1\t2026\n', { format: 'txt', sampleRate: 1_000 });
	assert.deepEqual(result.labels.map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })), [
		{ title: '2026', startFrame: 1_000, endFrame: 1_000 },
	]);
});

test('I02: lenient labels recover after an unrepresentable sample-frame timestamp', () => {
	const result = parseAudioEditorLabels('9999999999999999\tBad\n1\tKept\n', { format: 'txt', strict: false });
	assert.deepEqual(result.labels.map(({ title }) => title), ['Kept']);
	assert.deepEqual(result.warnings.map(({ code }) => code), ['TIME_RANGE']);
});

test('I03: rejected TXT rows do not bind their spectral continuation to an earlier label', () => {
	const result = parseAudioEditorLabels('0\tKept\nbad\tRejected\n\\\t20\t40\n', { format: 'txt', strict: false });
	assert.deepEqual(result.labels[0]?.opaqueExtensions, {});
	assert.deepEqual(result.warnings.map(({ code }) => code), ['INVALID_TIME', 'ORPHAN_CONTINUATION']);
});

test('I04: malformed TXT continuation commands are diagnosed', () => {
	assert.throws(() => parseAudioEditorLabels('0\tKept\n\\oops\t20\t40\n', { format: 'txt' }), { code: 'INVALID_CONTINUATION' });
});

test('I05: reserved WebVTT label identifiers cannot make exported labels disappear', () => {
	for (const cueIdentifier of ['NOTE', 'NOTE comment', 'STYLE', 'REGION']) {
		const text = serializeWebVttLabels([{ title: 'Kept', startFrame: 0, endFrame: 48_000, opaqueExtensions: { cueIdentifier } }]);
		assert.equal(parseAudioEditorLabels(text, { format: 'vtt' }).labels[0]?.title, 'Kept');
	}
});

test('I06: WebVTT label identifiers cannot inject cue lines or timing arrows', () => {
	for (const cueIdentifier of ['first\nsecond', 'first\rsecond', '00:00.000 --> 00:01.000', '\0']) {
		const text = serializeWebVttLabels([{ title: 'Kept', startFrame: 0, endFrame: 48_000, opaqueExtensions: { cueIdentifier } }]);
		assert.equal(parseAudioEditorLabels(text, { format: 'vtt' }).labels[0]?.title, 'Kept');
	}
});

test('I07: BOM-marked UTF-16 labels import without ANSI corruption', () => {
	const text = `1\n${timing}\nGrüße 世界\n`;
	assert.equal(parseAudioEditorLabels(utf16(text), { filename: 'captions.srt' }).labels[0]?.title, 'Grüße 世界');
});

test('I08: BOM-marked UTF-16 CUE sheets retain Unicode track names', () => {
	const text = 'FILE "album.wav" WAVE\nTRACK 01 AUDIO\nTITLE "Grüße 世界"\nINDEX 01 00:00:00\n';
	assert.equal(parseAudioEditorCueSheet(utf16(text), { sampleRate: 48_000 }).cues[0]?.title, 'Grüße 世界');
});

test('I09: SRT captions accept horizontal whitespace around their timing arrow', () => {
	assert.equal(caption('1\n00:00:00,000\t-->  00:00:01,000\nKept\n').track.cues[0]?.text, 'Kept');
});

test('I10: subtitle blocks separated by whitespace-only lines stay separate', () => {
	for (const format of ['srt', 'webvtt'] as const) {
		const text = format === 'srt' ? `1\n${timing}\nOne\n \t\n2\n${timing}\nTwo\n`
			: `WEBVTT\n\n${vttTiming}\nOne\n \t\n${vttTiming}\nTwo\n`;
		assert.deepEqual(caption(text, format).track.cues.map(({ text: body }) => body), ['One', 'Two']);
	}
});

test('I11: WebVTT standard spacing and directional entities decode as text', () => {
	assert.equal(caption(`WEBVTT\n\n${vttTiming}\nA&nbsp;B&lrm;&rlm;\n`, 'webvtt').track.cues[0]?.text, 'A\u00a0B\u200e\u200f');
});

test('I12: malformed numeric WebVTT entities cannot silently truncate their value', () => {
	for (const entity of ['&#12z;', '&#x41z;', '&#x;', '&#;']) {
		assert.throws(() => caption(`WEBVTT\n\n${vttTiming}\n${entity}\n`, 'webvtt'), { code: 'ACTIVE_CONTENT' });
	}
});

test('I13: generated caption IDs do not steal a later valid WebVTT ID', () => {
	const imported = caption(`WEBVTT\n\ninvalid id\n${vttTiming}\nOne\n\ncue-1\n${vttTiming}\nTwo\n`, 'webvtt');
	assert.equal(imported.track.cues.find(({ text }) => text === 'Two')?.id, 'cue-1');
	assert.notEqual(imported.track.cues.find(({ text }) => text === 'One')?.id, 'cue-1');
});

test('I20: detected dot-separated SubRip timestamps import consistently', () => {
	const result = parseAudioEditorLabels('1\n00:00:01.000 --> 00:00:02.000\nKept\n');
	assert.equal(result.format, 'srt');
	assert.equal(result.labels[0]?.title, 'Kept');
});

test('I21: short SubRip millisecond fields agree with the media decoder clock', () => {
	const text = '1\n00:00:01,1 --> 00:00:02,12\nKept\n';
	const labels = parseAudioEditorLabels(text, { format: 'srt', sampleRate: 1_000 });
	assert.equal(labels.labels[0]?.startFrame, 1_001);
	assert.equal(labels.labels[0]?.endFrame, 2_012);
	const imported = caption(text);
	assert.equal(imported.track.cues[0]?.startFrame, 48_048);
	assert.equal(imported.track.cues[0]?.endFrame, 96_576);
});

test('I25: WebVTT voice and emphasis retain their meaning in either wrapper order', () => {
	const imported = caption(`WEBVTT\n\n${vttTiming}\n<b><v Alex>Hello</v></b>\n`, 'webvtt');
	assert.equal(imported.track.cues[0]?.text, 'Hello');
	assert.equal(imported.track.speakers[0]?.name, 'Alex');
	assert.equal(imported.track.styles[0]?.fontWeight, 'bold');
});

test('I26: uppercase SubRip emphasis imports with its text and style intact', () => {
	const imported = caption(`1\n${timing}\n<B><I>Hello</i></b>\n`);
	assert.equal(imported.track.cues[0]?.text, 'Hello');
	assert.equal(imported.track.styles[0]?.fontWeight, 'bold');
	assert.equal(imported.track.styles[0]?.fontStyle, 'italic');
});

test('I27: WebVTT label import extracts visible text without displaying cue markup', () => {
	const input = `WEBVTT\n\n${vttTiming}\n<v Narrator><b>Hello</b> <i>world</i></v> &lt;b&gt;literal&lt;/b&gt;\n`;
	const imported = parseAudioEditorLabels(input, { format: 'vtt' });
	assert.equal(imported.labels[0]?.title, 'Hello world <b>literal</b>');
});

test('I28: single-quoted CUE filenames and metadata import without literal quote marks', () => {
	const input = "FILE 'album recording.wav' WAVE\nTRACK 01 AUDIO\nTITLE 'First song'\nPERFORMER 'The band'\nINDEX 01 00:00:00\n";
	const imported = parseAudioEditorCueSheet(input, { sampleRate: 48_000 });
	assert.equal(imported.cues[0]?.title, 'First song');
	assert.equal(imported.cues[0]?.performer, 'The band');
	const apostrophe = parseAudioEditorCueSheet(`FILE "C:\\Music\\O'Brien.wav" WAVE\nTRACK 01 AUDIO\nTITLE "O'Brien"\nINDEX 01 00:00:00\n`, { sampleRate: 48_000 });
	assert.equal(apostrophe.cues[0]?.title, "O'Brien");
});

test('I29: CUE index numbers do not require artificial leading zeroes', () => {
	const input = 'FILE "album.wav" WAVE\nTRACK 1 AUDIO\nINDEX 1 00:00:00\nTRACK 2 AUDIO\nINDEX 1 00:01:00\n';
	const imported = parseAudioEditorCueSheet(input, { sampleRate: 48_000 });
	assert.deepEqual(imported.cues.map(({ positionFrame }) => positionFrame), [0, 48_000]);
});
