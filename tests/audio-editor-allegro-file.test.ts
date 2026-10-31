/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile, writeAllegroFile } from '../src/common/editor/allegro-file.ts';

test('Allegro reads Audacity numeric seconds, track names, channel, velocity, and offset', () => {
	const parsed = parseAllegroFile('#offset 1.25\n#track 0 A piano\nT0 -tempor:120\nT0.5 V2 K60 P60 U0.25 L90\nT1 V2 P64 U0.5 L100\n', { sampleRate: 48_000 });
	assert.equal(parsed.tracks[0]?.name, 'A piano');
	assert.deepEqual(parsed.tracks[0]?.notes.map(({ id: _id, ...note }) => note), [
		{ pitch: 60, channel: 2, velocity: 90, startFrame: 84_000, durationFrames: 12_000 },
		{ pitch: 64, channel: 2, velocity: 100, startFrame: 108_000, durationFrames: 24_000 },
	]);
});

test('Allegro reads beat notation, sticky defaults, named pitches, triplets, and multiple tracks', () => {
	const parsed = parseAllegroFile('#track 0 Melody\nT0 -tempor:120\nTQ0 V0 C4 Q Lmf\nD4 I\nE4 IT\n#track 1 Bass\nT0 V1 C3 H\n', { sampleRate: 48_000 });
	assert.deepEqual(parsed.tracks[0]?.notes.map(n => [n.pitch, n.startFrame, n.durationFrames, n.velocity]), [
		[60, 0, 24_000, 100], [62, 24_000, 12_000, 100], [64, 36_000, 8_000, 100],
	]);
	assert.equal(parsed.tracks[1]?.notes[0]?.pitch, 48);
});

test('Allegro roundtrip preserves notes, tempo/signature changes and MIDI controller messages', () => {
	const document = parseAllegroFile('#track 0 Lead\nT0 -tempor:120\nT0 V- -timesig_numr:6\nT0 V- -timesig_denr:8\nT0 V0 -programi:40\nT0.25 V0 -control64r:1\nT0.5 V0 P67 U1 L110\nT1 -tempor:90\n');
	const parsed = parseAllegroFile(writeAllegroFile(document));
	assert.deepEqual(parsed.tempos, document.tempos);
	assert.deepEqual(parsed.signatures, document.signatures);
	assert.deepEqual(parsed.tracks, document.tracks);
});

test('Allegro rejects malformed notes, unsupported microtonal pitches, and unrepresentable attributes', () => {
	assert.throws(() => parseAllegroFile('T0 P60 U-1 L100'), /duration|negative/i);
	assert.throws(() => parseAllegroFile('T0 P60.5 U1 L100'), /pitch|microton/i);
	assert.throws(() => parseAllegroFile('T0 P200 U1 L100'), /pitch/i);
	assert.throws(() => parseAllegroFile('T0 P60 U1 L100 -customr:4'), /attribute|unsupported/i);
});

test('Allegro beat durations follow tempo changes and explicit beat anchors', () => {
	const parsed = parseAllegroFile('T0 -tempor:120\nTQ4 -tempor:60\nTQ3 P60 UQ3 L100\n');
	assert.equal(parsed.tracks[0]?.notes[0]?.startFrame, 72_000);
	assert.equal(parsed.tracks[0]?.notes[0]?.durationFrames, 120_000);
	const anchored = parseAllegroFile('T0 -beatr:0\nT2 -beatr:4\nTQ1 P60 Q L100\n');
	assert.equal(anchored.tracks[0]?.notes[0]?.startFrame, 24_000);
	assert.equal(anchored.tracks[0]?.notes[0]?.durationFrames, 24_000);
});

test('Allegro preserves expressive channel messages, text and hexadecimal SysEx using PortSMF attributes', () => {
	const parsed = parseAllegroFile('#track 0 Metadata\nT0 V2 -bendr:0.25\nT0 V2 -pressurer:0.5\nT0 V2 K60 -pressurer:1\nT0 V- -sysexs:"f07d0102f7"\nT0 V- -texts:"two words \\"quoted\\""\nT0 V- -keysigi:-3\nT0 V- -modea:\'minor\'\nT0 V2 P60 U1 L100\n');
	assert.deepEqual(parsed.tracks[0]?.events?.map(event => [event.status, event.metaType, event.data]), [
		[0xe2, undefined, [0, 80]], [0xd2, undefined, [64]], [0xa2, undefined, [60, 127]],
		[0xf0, undefined, [0x7d, 1, 2, 0xf7]], [0xff, 1, [...new TextEncoder().encode('two words "quoted"')]], [0xff, 89, [253, 1]],
	]);
	assert.deepEqual(parseAllegroFile(writeAllegroFile(parsed)), parsed);
});

test('Allegro rejects invalid channels, oversized input, impossible time maps, and unterminated strings', () => {
	assert.throws(() => parseAllegroFile('T0 V16 P60 U1'), /channel/i);
	assert.throws(() => parseAllegroFile('T0 -beatr:1'), /anchor/i);
	assert.throws(() => parseAllegroFile('T0 -texts:"unfinished'), /quoted/i);
	assert.throws(() => parseAllegroFile(' '.repeat(16 * 1024 * 1024 + 1)), /limit/i);
});
