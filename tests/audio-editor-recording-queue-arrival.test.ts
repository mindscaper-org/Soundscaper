/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createRecordingController } from '../src/common/editor/recording.js';

interface NativeMessage {
	readonly type: string;
	readonly frameStart?: number;
	readonly frames?: number;
	readonly channels?: readonly Float32Array[];
}
class NativeRecorderNode {
	readonly port = { onmessage: null as ((event: Readonly<{ data: NativeMessage }>) => void) | null,
		start() {}, postMessage: (message: NativeMessage) => {
			if (message.type === 'stop') queueMicrotask(() => { this.port.onmessage?.({ data: { type: 'stopped' } }); });
		} };
	connect() {} disconnect() {}
	emit(frameStart: number) { this.port.onmessage?.({ data: { type: 'audio-chunk', frameStart, frames: 128, channels: [new Float32Array(128)] } }); }
}

test('the recorder stamps native arrival before its own serial PCM write queue', async context => {
	let now = 0, release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	const node = new NativeRecorderNode(); const receipts: Array<number | undefined> = [];
	const audioContext = { sampleRate: 8000, currentTime: 0, async resume() {}, destination: {},
		audioWorklet: { async addModule() {} }, createMediaStreamSource: () => ({ connect() {}, disconnect() {} }) };
	const request = { context: audioContext, stream: { getAudioTracks: () => [], getTracks: () => [] },
		channelCount: 1, monitor: false, inputGain: 1, onState() {}, onError(error: unknown) { throw error; },
		receiptTime: () => now, nodeFactory: () => node,
		onChunk: async (chunk: Readonly<{ receiptTimeMs?: number }>) => { receipts.push(chunk.receiptTimeMs);
			if (receipts.length === 1) { entered(); await gate; } },
	} satisfies RecordingControllerFactoryOptions & { readonly nodeFactory: () => NativeRecorderNode };
	const controller = await createRecordingController(request);
	context.after(async () => { release(); await controller.detach(); });
	controller.start({ startFrame: 0 });
	now = 10; node.emit(0); await writing;
	now = 20; node.emit(128);
	now = 30; release(); await controller.stop();
	assert.deepEqual(receipts, [10, 20]);
});
