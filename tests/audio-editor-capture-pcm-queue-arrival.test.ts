/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserAudioRecorder, type FramescaperWorkletRecordingControllerOptions } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';
import { createFramescaperCapturePcmPacketizer } from '../src/common/editor/controller/capture/internal/framescaper-capture-pcm-packetizer.ts';

test('capture PCM packets retain their producer arrival while an earlier storage write is pending', async context => {
	let now = 0, release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	let emit: FramescaperWorkletRecordingControllerOptions['onChunk'] = () => { throw new Error('Recorder is not admitted.'); };
	const receipts: number[] = [];
	const packetizer = createFramescaperCapturePcmPacketizer({ sessionId: 'session', streamId: 'microphone', role: 'microphone',
		sampleRate: 8000, channelCount: 1, receiptTime: () => now });
	const recorder = await createFramescaperBrowserAudioRecorder({ role: 'microphone', stream: {},
		track: { getSettings: () => ({ sampleRate: 8000, channelCount: 1 }) }, context: { sampleRate: 8000 }, MediaStreamTrackProcessor: null, receiptTime: () => now,
		recordingControllerFactory: options => { emit = options.onChunk; return {
			start() {}, pause() { return true; }, resume() { return true; }, async stop() {}, async detach() {},
		}; },
		onChunk: async chunk => { receipts.push(packetizer.packet(chunk).receiptTimeMs); if (receipts.length === 1) { entered(); await gate; } },
	});
	context.after(async () => { release(); await recorder.dispose(); });
	await recorder.start();
	now = 500; const first = emit({ frameStart: 0, frames: 4000, channels: [new Float32Array(4000)] }); await writing;
	now = 1000; const second = emit({ frameStart: 4000, frames: 4000, channels: [new Float32Array(4000)] });
	now = 3000; release(); await Promise.all([first, second]);
	assert.deepEqual(receipts, [500, 1000]);
});
