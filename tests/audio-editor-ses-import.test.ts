/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSesDocument } from '../src/common/editor/ses-import.ts';
import { SES_BINARY_MAXIMUM_BYTES } from '../src/common/editor/ses-format.ts';
import { createSesFixture } from './helpers/ses-fixture.ts';

test('legacy SES preserves media references, track controls and sample-accurate clip trims', () => {
	const { document, warnings } = parseSesDocument(createSesFixture({
		tracks: [{ name: 'Voix été', gain: 0.5, mute: true }, { name: 'Empty', gain: 1 }],
		files: [{ id: 0xf1234567, path: 'C:\\media\\Voix été.WAV' }],
		clips: [{ fileId: 0xf1234567, startFrame: 4800, lengthFrames: 9600, sourceInFrame: 2400 }],
	}));
	assert.equal(document.sampleRate, 48_000);
	assert.equal(document.tracks.length, 2);
	assert.equal(document.tracks[0]!.name, 'Voix été');
	assert.equal(document.tracks[0]!.gain, 0.5);
	assert.equal(document.tracks[0]!.mute, true);
	assert.equal(document.tracks[1]!.clips.length, 0);
	const clip = document.tracks[0]!.clips[0]!;
	assert.deepEqual([clip.startFrame, clip.endFrame, clip.sourceInFrame, clip.sourceOutFrame], [4800, 14_400, 2400, 12_000]);
	assert.equal(clip.fileId, String(0xf1234567));
	assert.equal(document.files.get(clip.fileId)!.absolutePath, 'C:\\media\\Voix été.WAV');
	assert.equal(document.files.get(clip.fileId)!.name, 'Voix été.WAV');
	assert.ok(warnings.some(warning => warning.code === 'ses.partial-import'));
});

test('legacy SES reads relative media from WLST and preserves clip order within each track', () => {
	const { document } = parseSesDocument(createSesFixture({
		fileContainer: 'WLST', files: [{ path: 'audio/Take one.wav' }],
		clips: [{ startFrame: 9600 }, { startFrame: 0 }],
	}));
	assert.equal(document.files.get('1000')!.relativePath, 'audio/Take one.wav');
	assert.deepEqual(document.tracks[0]!.clips.map(clip => clip.startFrame), [9600, 0]);
	assert.deepEqual(document.tracks[0]!.clips.map(clip => clip.zOrder), [0, 1]);
});

test('legacy SES permits a valid empty session and rejects missing source-file references', () => {
	assert.equal(parseSesDocument(createSesFixture({ tracks: [], clips: [], files: [] })).document.tracks.length, 0);
	assert.throws(() => parseSesDocument(createSesFixture({ files: [] })), /media reference/iu);
});

test('legacy SES reports unknown chunks and unsupported mix features', () => {
	const { warnings } = parseSesDocument(createSesFixture({ extraChunks: [
		{ id: 'tkfx', body: new Uint8Array([1]) },
		{ id: 'loop', body: new Uint8Array([10, 0, 0, 0]) },
		{ id: '????', body: new Uint8Array([1]) },
	] }));
	assert.ok(warnings.some(warning => warning.code === 'ses.effects-omitted'));
	assert.ok(warnings.some(warning => warning.code === 'ses.loops-omitted'));
	assert.ok(warnings.some(warning => warning.code === 'ses.unknown-chunks'));
});

test('legacy SES rejects non-session, truncated, oversized and inconsistent inputs', () => {
	assert.equal(SES_BINARY_MAXIMUM_BYTES, 32 * 1024 * 1024);
	assert.throws(() => parseSesDocument(new Uint8Array(12)), /COOLNESS/iu);
	const valid = createSesFixture();
	assert.throws(() => parseSesDocument(valid.subarray(0, valid.length - 1)), /size|truncat/iu);
	assert.throws(() => parseSesDocument(valid, { maximumBytes: valid.length - 1 }), /limit/iu);
	assert.throws(() => parseSesDocument(valid, { maximumBytes: Number.NaN }), /limit/iu);
	const badChunk = valid.slice();
	new DataView(badChunk.buffer).setUint32(16, 0xffffffff, true);
	assert.throws(() => parseSesDocument(badChunk), /chunk|bound/iu);
	const badRecord = valid.slice();
	new DataView(badRecord.buffer).setUint32(chunkOffset(badRecord, 'blk ') + 8, 2, true);
	assert.throws(() => parseSesDocument(badRecord), /layout|record/iu);
	const badCount = valid.slice();
	new DataView(badCount.buffer).setUint32(chunkOffset(badCount, 'blk ') + 8, 0xffffffff, true);
	assert.throws(() => parseSesDocument(badCount), /count|record|limit/iu);
});

test('legacy SES rejects invalid clip geometry, track references and track gain', () => {
	for (const clip of [{ lengthFrames: 0 }, { track: -1 }, { track: 0 }, { track: 1025 }]) {
		assert.throws(() => parseSesDocument(createSesFixture({ clips: [clip] })), /clip|track/iu);
	}
	for (const gain of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
		assert.throws(() => parseSesDocument(createSesFixture({ tracks: [{ gain }] })), /gain/iu);
	}
});

test('legacy SES rejects duplicate core chunks, media IDs and duplicate clip handles', () => {
	assert.throws(() => parseSesDocument(createSesFixture({ files: [{ id: 1000 }, { id: 1000 }] })), /duplicate/iu);
	assert.throws(() => parseSesDocument(createSesFixture({ clips: [{ handle: 10 }, { handle: 10 }] })), /duplicate/iu);
	assert.throws(() => parseSesDocument(createSesFixture({ extraChunks: [{ id: 'hdr ', body: new Uint8Array(4) }] })), /duplicate/iu);
});

test('legacy SES cannot discover forged file records inside another chunk', () => {
	const forged = createSesFixture().subarray(-29);
	assert.throws(() => parseSesDocument(createSesFixture({ files: [], extraChunks: [{ id: 'fake', body: forged }] })), /media reference/iu);
});

test('legacy SES respects the bounds of a Uint8Array view', () => {
	const bytes = createSesFixture();
	const padded = new Uint8Array(bytes.length + 20);
	padded.set(bytes, 7);
	assert.equal(parseSesDocument(padded.subarray(7, 7 + bytes.length)).document.sampleRate, 48_000);
});

test('legacy SES preserves verified static clip gain, mute, track solo and master volume', () => {
	const fixture = createSesFixture({ tracks: [{ solo: true }], clips: [{ gain: 0.25, mute: true }] });
	const headerBodyOffset = chunkOffset(fixture, 'hdr ') + 8;
	new DataView(fixture.buffer).setFloat64(headerBodyOffset + 16, 0.75, true);
	new DataView(fixture.buffer).setFloat64(headerBodyOffset + 24, 0.75, true);
	const { document } = parseSesDocument(fixture);
	assert.equal(document.tracks[0]!.solo, true);
	assert.equal(document.tracks[0]!.clips[0]!.gain, 0.25);
	assert.equal(document.tracks[0]!.clips[0]!.muted, true);
	assert.equal(document.master.gain, 0.75);
});

test('legacy SES explicitly reports conversion of unequal left and right gains', () => {
	const { document, warnings } = parseSesDocument(createSesFixture({ tracks: [{ gain: 0.5, rightGain: 0.25 }] }));
	assert.equal(document.tracks[0]!.gain, 0.5);
	assert.equal(document.tracks[0]!.pan, 0);
	assert.ok(warnings.some(warning => warning.code === 'ses.channel-gain-converted'));
});

test('legacy SES supports independently documented older record sizes', () => {
	for (const clipRecordBytes of [72, 84, 88] as const) {
		for (const trackRecordBytes of [72, 96, 152] as const) {
			const { document } = parseSesDocument(createSesFixture({ clipRecordBytes, trackRecordBytes }));
			assert.equal(document.tracks[0]!.clips[0]!.endFrame, 14_400);
		}
	}
});

test('legacy SES preserves unsigned sample offsets beyond the signed 32-bit range', () => {
	const { document } = parseSesDocument(createSesFixture({ clips: [{ startFrame: 0x80000000, sourceInFrame: 0x80000001 }] }));
	const clip = document.tracks[0]!.clips[0]!;
	assert.equal(clip.startFrame, 0x80000000);
	assert.equal(clip.sourceInFrame, 0x80000001);
	assert.equal(clip.sourceOutFrame, 0x80000001 + 9600);
});

test('legacy SES rejects unterminated, control-bearing and overlong media paths', () => {
	assert.throws(() => parseSesDocument(createSesFixture({ files: [{ path: 'Voice\n.wav' }] })), /path/iu);
	assert.throws(() => parseSesDocument(createSesFixture({ files: [{ path: `${'v'.repeat(4097)}.wav` }] })), /path/iu);
	const fixture = createSesFixture();
	const recordOffset = chunkOffset(fixture, 'LISTFILE') + 12;
	fixture.fill(65, recordOffset + 16);
	assert.throws(() => parseSesDocument(fixture), /terminator/iu);
});

test('legacy SES rejects overlapping legacy clips on one track without assuming stacking order', () => {
	for (const clips of [
		[{ startFrame: 0 }, { startFrame: 4800 }],
		[{ startFrame: 4800 }, { startFrame: 0 }],
		[{ startFrame: 0, lengthFrames: 20_000 }, { startFrame: 5000, lengthFrames: 1000 }],
	]) {
		assert.throws(() => parseSesDocument(createSesFixture({ clips })), /overlapping legacy clips/iu);
	}
});

test('legacy SES permits adjacent unsorted clips and simultaneous clips on different tracks', () => {
	const { document } = parseSesDocument(createSesFixture({
		tracks: [{ name: 'Voice' }, { name: 'Music' }],
		clips: [{ track: 1, startFrame: 9600 }, { track: 1, startFrame: 0 }, { track: 2, startFrame: 0 }],
	}));
	assert.deepEqual(document.tracks.map(track => track.clips.length), [2, 1]);
});

function chunkOffset(bytes: Uint8Array, id: string): number {
	const offset = new TextDecoder('latin1').decode(bytes).indexOf(id, 12);
	assert.ok(offset >= 0, `The fixture has a ${id} chunk.`);
	return offset;
}
