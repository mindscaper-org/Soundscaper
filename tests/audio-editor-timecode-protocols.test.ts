/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timecodeFromFrames, timecodeToFrames, timecodeRate, timecodeDayFrames } from '../src/common/editor/timecode-sync-format.ts';
import { encodeMtcFullFrame, encodeMtcQuarterFrames, MtcDecoder } from '../src/common/editor/timecode-mtc.ts';
import { encodeLtcFrame, decodeLtcFrame, LtcDecoder, LtcEncoder } from '../src/common/editor/timecode-ltc.ts';

test('timecode uses existing drop-frame labels and wraps at midnight', () => {
	assert.deepEqual(timecodeFromFrames(1800, '29.97df'), { negative: false, hours: 0, minutes: 1, seconds: 0, frames: 2 });
	assert.equal(timecodeToFrames({ hours: 1, minutes: 0, seconds: 0, frames: 0 }, '29.97df'), 107892);
	assert.equal(timecodeFromFrames(-1, '25').hours, 23);
	assert.equal(timecodeFromFrames(timecodeDayFrames('29.97df'), '29.97df').hours, 0);
	assert.equal(timecodeRate('29.97df'), 30000 / 1001);
	assert.throws(() => timecodeToFrames({ hours: 24, minutes: 0, seconds: 0, frames: 0 }, '25'));
});

test('MTC emits independent full-frame and quarter-frame wire vectors', () => {
	const frame = timecodeToFrames({ hours: 1, minutes: 2, seconds: 3, frames: 4 }, '25');
	assert.deepEqual(encodeMtcFullFrame(frame, '25'), [0xf0, 0x7f, 0x7f, 1, 1, 0x21, 2, 3, 4, 0xf7]);
	assert.deepEqual(encodeMtcQuarterFrames(frame, '25'), [4, 0x10, 0x23, 0x30, 0x42, 0x50, 0x61, 0x72]);
});

test('MTC accepts split SysEx with interleaved realtime bytes, rejecting invalid labels', () => {
	const decoder = new MtcDecoder();
	assert.deepEqual(decoder.push([0xf0, 0x7f, 0, 1, 0xf8, 1, 0x21]), []);
	assert.deepEqual(decoder.push([2, 3, 4, 0xf7]), [{ frame: 93079, rate: '25', direction: 0 }]);
	assert.deepEqual(decoder.push([0xf0, 0x7f, 0x7f, 1, 1, 0x38, 0, 0, 0, 0xf7]), []);
	assert.deepEqual(decoder.push([0xf0, 0x7f, 0x7f, 1, 1, 0x40, 1, 0, 0, 0xf7]), []);
});

test('MTC requires ordered complete cycles and compensates two frames in either direction', () => {
	const decoder = new MtcDecoder();
	const nibbles = [0, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x72];
	assert.deepEqual(decoder.push(nibbles.flatMap(value => [0xf1, value])), [{ frame: 2, rate: '25', direction: 1 }]);
	assert.deepEqual(decoder.push(nibbles.slice().reverse().flatMap(value => [0xf1, value])), [{ frame: 2159998, rate: '25', direction: -1 }]);
	assert.deepEqual(decoder.push([0xf1, 0, 0xf1, 0x20, ...nibbles.slice(3).flatMap(value => [0xf1, value])]), []);
});

test('LTC layout matches SMPTE bit positions, sync word, parity and BCD validation', () => {
	const bits = encodeLtcFrame(93079, '25');
	assert.deepEqual([...bits.slice(64)], [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
	assert.deepEqual([bits[2], bits[16], bits[17], bits[33], bits[48]], [1, 1, 1, 1, 1]);
	assert.equal([...bits].filter(bit => bit === 0).length % 2, 0);
	assert.equal(decodeLtcFrame(bits, '25'), 93079);
	bits[0] = 1; bits[1] = 1; bits[3] = 1;
	assert.equal(decodeLtcFrame(bits, '25'), null);
});

for (const rate of ['24', '25', '29.97df', '30'] as const) {
	for (const sampleRate of [44100, 48000]) {
		test(`LTC streams across arbitrary blocks at ${rate} fps / ${sampleRate} Hz, with inverted polarity`, () => {
			const encoder = new LtcEncoder(sampleRate, rate);
			const decoder = new LtcDecoder(sampleRate, rate);
			encoder.seek(1798);
			const samples = new Float32Array(Math.ceil(sampleRate * 0.4));
			encoder.write(samples);
			const frames: number[] = [];
			for (let i = 0; i < samples.length; i += 137) {
				const block = samples.slice(i, i + 137).map(value => -value * 0.3);
				frames.push(...decoder.push(block).map(value => value.frame));
			}
			assert.ok(frames.length >= 7);
			assert.deepEqual(frames.slice(0, 4), [1798, 1799, 1800, 1801]);
		});
	}
}

test('LTC ignores silence and invalid sync without accumulating unbounded history', () => {
	const decoder = new LtcDecoder(48000, '25');
	assert.deepEqual(decoder.push(new Float32Array(48000)), []);
	const bits = encodeLtcFrame(0, '25'); bits[79] = 0;
	assert.equal(decodeLtcFrame(bits, '25'), null);
});

test('MTC discards a partial cycle across a signal gap and recovers on a fresh complete cycle', () => {
	const decoder = new MtcDecoder(), bytes = [0, 16, 32, 48, 64, 80, 96, 114];
	assert.deepEqual(decoder.push(bytes.slice(0, 4).flatMap(value => [241, value]), 1), []);
	assert.deepEqual(decoder.push(bytes.slice(4).flatMap(value => [241, value]), 500), []);
	assert.equal(decoder.push(bytes.flatMap(value => [241, value]), 501)[0].frame, 2);
});

test('MIDI Clock cannot keep an abandoned timecode cycle alive', () => {
	const decoder = new MtcDecoder();
	const first = encodeMtcQuarterFrames(52, '25');
	const later = encodeMtcQuarterFrames(200, '25');
	const wire = (pieces: readonly number[]) => pieces.flatMap(value => [0xf1, value]);
	assert.deepEqual(decoder.push(wire(first.slice(0, 4)), 1), []);
	for (let timestamp = 20; timestamp < 500; timestamp += 20) {
		assert.deepEqual(decoder.push([0xf8], timestamp), []);
	}
	assert.deepEqual(decoder.push(wire(later.slice(4)), 500), []);
	assert.deepEqual(decoder.push(wire(later), 501), [{ frame: 202, rate: '25', direction: 1 }]);
});

test('MTC discards stale incomplete full-frame and quarter-frame messages across a signal gap', () => {
	const decoder = new MtcDecoder();
	const full = encodeMtcFullFrame(93079, '25');
	assert.deepEqual(decoder.push(full.slice(0, 7), 1), []);
	assert.deepEqual(decoder.push(full.slice(7), 500), []);
	assert.deepEqual(decoder.push(full, 501), [{ frame: 93079, rate: '25', direction: 0 }]);
	const quarter = encodeMtcQuarterFrames(93079, '25');
	assert.deepEqual(decoder.push([0xf1], 502), []);
	assert.deepEqual(decoder.push([quarter[0], ...quarter.slice(1).flatMap(byte => [0xf1, byte])], 1000), []);
	assert.deepEqual(decoder.push(quarter.flatMap(byte => [0xf1, byte]), 1001), [{ frame: 93081, rate: '25', direction: 1 }]);
});

test('LTC recognizes reverse playback and enforces the selected drop-frame flag', () => {
	const encoder = new LtcEncoder(48000, '25'), decoder = new LtcDecoder(48000, '25');
	encoder.seek(100);
	const audio = new Float32Array(48000); encoder.write(audio);
	const readings = decoder.push(audio.reverse());
	assert.ok(readings.length > 20);
	assert.ok(readings.every(reading => reading.direction === -1));
	assert.deepEqual(readings.slice(0, 4).map(reading => reading.frame), [124, 123, 122, 121]);
	assert.equal(decodeLtcFrame(encodeLtcFrame(1800, '29.97df'), '30'), null);
	const legacy25 = encodeLtcFrame(0, '25'); legacy25[10] = 1;
	assert.equal(decodeLtcFrame(legacy25, '25'), 0);
});
