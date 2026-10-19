/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ChunkStreamPlaybackProcessor } from '../src/common/editor/chunk-stream-worklet.js';
import { installChunkStreamWorker } from '../src/common/editor/chunk-stream-worker.js';

interface StreamMessage {
	readonly type: string;
	readonly streamId?: string;
	readonly frame?: number;
	readonly progress?: number;
	readonly frames?: number;
	readonly [key: string]: unknown;
}

type MessageListener = (event: { readonly data: StreamMessage }) => void;

test('direct worker protocol leaves progress off by default while preserving demand, backpressure and source errors', () => {
	const worker = new LinkedWorker();
	worker.postMessage({
		type: 'open-stream', streamId: 'unobserved',
		source: { channelCount: 1, frameCount: 2_048, chunkFrames: 2_048 }, highWaterMark: 1,
	});
	worker.postMessage({ type: 'start-stream', streamId: 'unobserved' });
	const request = worker.sent.find((message) => message.type === 'need-storage-chunk');
	assert.ok(request);
	worker.postMessage({
		type: 'storage-chunk', streamId: 'unobserved',
		requestId: request.requestId, chunkIndex: request.chunkIndex, channels: [new Float32Array(2_048)],
	});
	const first = worker.sent.find((message) => message.type === 'audio-packet');
	assert.ok(first);
	assert.equal(worker.sent.filter((message) => message.type === 'audio-packet').length, 1);
	assert.equal(worker.sent.some((message) => message.type === 'stream-progress'), false);
	worker.postMessage({ type: 'packet-consumed', streamId: 'unobserved', packetId: first.packetId });
	const second = worker.sent.filter((message) => message.type === 'audio-packet').at(-1);
	assert.ok(second);
	assert.equal(worker.sent.some((message) => message.type === 'source-ended'), true);
	worker.postMessage({ type: 'packet-consumed', streamId: 'unobserved', packetId: second.packetId });
	assert.equal(worker.sent.at(-1)?.type, 'stream-complete');
	worker.postMessage({
		type: 'open-stream', streamId: 'failed-source',
		source: { channelCount: 1, frameCount: 128, chunkFrames: 128 },
	});
	worker.postMessage({ type: 'start-stream', streamId: 'failed-source' });
	worker.postMessage({ type: 'storage-error', streamId: 'failed-source', message: 'Storage unavailable' });
	assert.equal(worker.sent.at(-1)?.type, 'stream-error');
	assert.equal(worker.server.size, 0);
	worker.terminate();
});

test('direct worklet protocol leaves playhead reporting off by default and keeps underrun and end reports', () => {
	const port = new LinkedPort();
	const processor = new ChunkStreamPlaybackProcessor({ processorOptions: { messagePort: port, channelCount: 1 } });
	port.dispatch({ type: 'configure-stream', streamId: 'unobserved', channelCount: 1, startFrame: 0, endFrame: 2_048 });
	port.dispatch({ type: 'play-stream', streamId: 'unobserved' });
	for (let block = 0; block < 16; block += 1) render(processor);
	assert.equal(port.sent.some((message) => message.type === 'stream-playhead'), false);
	assert.equal(port.sent.some((message) => message.type === 'stream-underrun'), true);
	assert.equal(port.sent.at(-1)?.type, 'stream-ended');
	port.dispatch({ type: 'configure-stream', streamId: 'invalid', channelCount: 1, startFrame: 0, endFrame: 0 });
	assert.equal(port.sent.at(-1)?.type, 'stream-error');
});

function render(processor: ChunkStreamPlaybackProcessor): Float32Array {
	const output = new Float32Array(128);
	processor.process([], [[output]]);
	return output;
}

class LinkedPort {
	onmessage: MessageListener | null = null;
	readonly sent: StreamMessage[] = [];
	start(): void {}
	close(): void {}
	postMessage(message: StreamMessage): void {
		this.sent.push(message);
	}
	dispatch(data: StreamMessage): void {
		this.onmessage?.({ data });
	}
}

class LinkedWorker {
	readonly sent: StreamMessage[] = [];
	readonly listeners = new Set<MessageListener>();
	readonly inbound = new Set<MessageListener>();
	readonly server: ReturnType<typeof installChunkStreamWorker>;
	constructor() {
		const scope = {
			addEventListener: (_type: string, listener: MessageListener): void => { this.inbound.add(listener); },
			removeEventListener: (_type: string, listener: MessageListener): void => { this.inbound.delete(listener); },
			postMessage: (message: StreamMessage): void => {
				this.sent.push(message);
				for (const listener of this.listeners) listener({ data: message });
			},
		};
		this.server = installChunkStreamWorker(scope as unknown as typeof globalThis);
	}
	addEventListener(type: string, listener: MessageListener): void { if (type === 'message') this.listeners.add(listener); }
	postMessage(data: StreamMessage): void { for (const listener of this.inbound) listener({ data }); }
	terminate(): void { this.server.dispose(); }
}
