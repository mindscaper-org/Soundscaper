/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserRecorderFactory } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-recorder-factory.ts';
import type { CapturePacket } from '../src/common/editor/framescaper-capture-domain.ts';
import type { FramescaperAudioDataLike, FramescaperAudioTrackProcessorReader } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';
import { waitFor } from './helpers/async-test-control.ts';

class Data implements FramescaperAudioDataLike {
	readonly numberOfChannels = 1; readonly sampleRate = 48_000;
	closed = false;
	constructor(readonly timestamp: number, readonly numberOfFrames = 480) {}
	copyTo(target: Float32Array): void { target.fill(.25); }
	close(): void { this.closed = true; }
}
async function fixture() {
	let resolve: ((value: { done: boolean; value?: Data }) => void) | undefined;
	let totalFrames = 0, discardedFrames = 0;
	const reader: FramescaperAudioTrackProcessorReader = {
		read: () => new Promise(value => { resolve = value; }),
		cancel: () => { resolve?.({ done: true }); return Promise.resolve(); }, releaseLock() {},
	};
	class Processor {
		readonly readable = { getReader: () => reader };
		get totalFrames() { return totalFrames; }
		get discardedFrames() { return discardedFrames; }
	}
	const packets: CapturePacket[] = [], errors: unknown[] = [];
	const track = { kind: 'audio', stop() {}, getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }) };
	const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
	const factory = createFramescaperBrowserRecorderFactory({ getAudioContext: () => ({ sampleRate: 48_000 }), MediaStreamTrackProcessor: Processor });
	const recorder = await factory({ sessionId: 'session', streamId: 'mic', sourceId: 'source',
		source: { sourceId: 'picker', role: 'microphone', track, stream, settings: {}, capabilities: {} },
		monitoring: false, inputGain: 1, onPacket: async packet => { packets.push(packet); },
		onError: error => { errors.push(error); }, onBackpressure() { throw Error('unexpected pressure'); },
	});
	return { recorder, packets, errors, async push(timestamp: number, discarded = 0, frames = 480) {
		totalFrames += discarded + 1; discardedFrames += discarded;
		const data = new Data(timestamp, frames); resolve?.({ done: false, value: data });
		await waitFor(() => data.closed, 'native AudioData to close');
	} };
}
function timing(packets: readonly CapturePacket[]) {
	return packets.map(packet => [packet.presentationTimeUs, packet.durationUs, packet.droppedBefore.value]);
}

test('production capture factory preserves a native AudioData gap and exact missing-frame evidence', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(1_000_000); await f.push(1_030_000, 2);
	await f.recorder.stop(); await f.recorder.dispose();
	assert.deepEqual(timing(f.packets), [[0, 10_000, 0], [30_000, 10_000, 960]]);
	assert.deepEqual(f.errors, []);
});

test('a counter sampled after an older frame was dequeued associates its loss with the following timestamp gap', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(0); await f.push(10_000, 2); await f.push(40_000);
	await f.recorder.stop(); await f.recorder.dispose();
	assert.deepEqual(timing(f.packets), [[0, 20_000, 0], [40_000, 10_000, 960]]);
});

test('native discarded-block evidence determines exact holes despite privacy-rounded timestamps', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(0); await f.push(29_900, 2);
	await f.recorder.stop(); await f.recorder.dispose();
	assert.deepEqual(timing(f.packets), [[0, 10_000, 0], [30_000, 10_000, 960]]);
});

test('intentional Pause excludes the native timestamp span from dropped frames and active PCM time', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(0); await f.recorder.pause(); await f.push(10_000);
	await f.recorder.resume(); await f.push(30_000, 1);
	await f.recorder.stop(); await f.recorder.dispose();
	assert.deepEqual(timing(f.packets), [[0, 10_000, 0], [10_000, 10_000, 0]]);
});

test('native sub-quantum timestamp jitter preserves known sample continuity', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(95_299); await f.push(105_399); await f.push(115_299);
	await f.recorder.stop(); await f.recorder.dispose();
	assert.deepEqual(timing(f.packets), [[0, 30_000, 0]]);
	assert.deepEqual(f.errors, []);
});

test('native wall-clock bursts and regressions retain all ordered lossless PCM', async () => {
	const f = await fixture(); await f.recorder.start(0);
	// Real Chromium WebAudio destination blocks: 10 ms of PCM can arrive
	// with only 2 ms between estimated capture timestamps.
	for (const timestamp of [4_052_355, 4_054_410, 4_053_000, 4_082_355]) await f.push(timestamp);
	await f.recorder.stop(); await f.recorder.dispose();
	assert.deepEqual(timing(f.packets), [[0, 40_000, 0]]);
	assert.deepEqual(f.errors, []);
});

test('a long lossless native burst clock neither adds holes nor drifts from delivered sample counts', async () => {
	const f = await fixture(); await f.recorder.start(20_000);
	for (let index = 0; index < 1_000; index++) {
		const timestamp = 1_000_000 + Math.floor(index / 10) * 100_000 + [0, 2_055, 1_000, 11_000, 12_000, 50_000, 51_000, 52_000, 80_000, 90_000][index % 10]!;
		await f.push(timestamp);
	}
	await f.recorder.stop(); await f.recorder.dispose();
	let deliveredFrames = 0;
	for (const packet of f.packets) {
		assert.equal(packet.kind, 'pcm-audio');
		if (packet.kind !== 'pcm-audio') throw new Error('Native audio must produce PCM.');
		assert.equal(packet.presentationTimeUs, Math.round((960 + deliveredFrames) * 1_000_000 / 48_000));
		deliveredFrames += packet.frameCount;
	}
	assert.equal(deliveredFrames, 480_000);
	assert.ok(f.packets.every(packet => packet.droppedBefore.value === 0));
	assert.deepEqual(f.errors, []);
});

test('native loss with a backward timestamp fails instead of guessing its position', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(100_000); await f.push(90_000, 1);
	try { assert.match(String(f.errors[0]), /timestamp|backward|overlap/iu); }
	finally { await Promise.resolve(f.recorder.stop()).catch(() => undefined); await Promise.resolve(f.recorder.dispose()).catch(() => undefined); }
});

test('loss after an unreliable native clock fails rather than inventing exact placement', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(100_000); await f.push(102_055);
	await f.push(112_055); await f.push(122_055); await f.push(152_055, 2);
	try { assert.match(String(f.errors[0]), /ambiguous|unreliable/iu); }
	finally { await Promise.resolve(f.recorder.stop()).catch(() => undefined); await Promise.resolve(f.recorder.dispose()).catch(() => undefined); }
});

test('a block-size change across loss fails instead of guessing the missing sample count', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(0); await f.push(20_000, 1, 240);
	try { assert.match(String(f.errors[0]), /format.*discarded/iu); }
	finally { await Promise.resolve(f.recorder.stop()).catch(() => undefined); await Promise.resolve(f.recorder.dispose()).catch(() => undefined); }
});

test('loss before first native delivery fails honestly before admitting an unplaceable prefix', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(30_000, 2);
	try {
		assert.match(String(f.errors[0]), /lost initial.*source clock/iu);
		assert.deepEqual(f.packets, []);
	} finally { await Promise.resolve(f.recorder.stop()).catch(() => undefined); await Promise.resolve(f.recorder.dispose()).catch(() => undefined); }
});

test('lossless native block-size changes preserve the exact delivered sample count', async () => {
	const f = await fixture(); await f.recorder.start(0);
	await f.push(0); await f.push(10_000, 0, 240); await f.push(15_000, 0, 240);
	await f.recorder.stop(); await f.recorder.dispose();
	assert.deepEqual(timing(f.packets), [[0, 20_000, 0]]);
	assert.deepEqual(f.errors, []);
});
