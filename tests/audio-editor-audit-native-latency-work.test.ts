/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePluginRealtimeProcessor, NATIVE_PLUGIN_CONTROL } from '../src/common/editor/native-plugin-realtime-worklet.js';

interface ProcessMessage {
	readonly protocolVersion: number;
	readonly kind: string;
	readonly requestId: string;
	readonly frameCount: number;
	readonly input: Float32Array[];
	readonly output: Float32Array[];
}

test('native playback reports latency once per value and attachment while retaining every delayed PCM block', () => {
	const processor = new NativePluginRealtimeProcessor({ processorOptions: { instanceId: 'latency-work', channelCount: 2, queueCapacity: 4 } });
	const control: { type: string; latencyFrames?: number }[] = [];
	Object.defineProperty(processor.port, 'postMessage', { value: (message: typeof control[number]) => { control.push(message); } });
	let nativeLatency = 0;
	const peer = () => ({
		onmessage: null as ((event: { data: ProcessMessage & { reportedLatencyFrames: number } }) => void) | null,
		postMessage(message: ProcessMessage) {
			if (message.kind !== 'process') return;
			for (let channel = 0; channel < 2; channel++) message.output[channel]!.set(message.input[channel]!);
			this.onmessage?.({ data: { ...message, kind: 'processed', reportedLatencyFrames: nativeLatency } });
		}, start() {}, close() {},
	});
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 1 }, ports: [peer()] });
	for (let block = 0; block < 375; block++) {
		const output = [new Float32Array(128), new Float32Array(128)];
		processor.process([[new Float32Array(128).fill(block + 1), new Float32Array(128).fill(-block - 1)]], [output]);
		assert.equal(output[0]!.every(value => value === (block < 4 ? 0 : block - 3)), true);
		assert.equal(output[1]!.every(value => value === (block < 4 ? 0 : 3 - block)), true);
	}
	const latencies = () => control.filter(message => message.type === NATIVE_PLUGIN_CONTROL.latency).map(message => message.latencyFrames);
	assert.deepEqual(latencies(), [512]);
	nativeLatency = 256;
	for (let block = 0; block < 10; block++) processor.process([[new Float32Array(128), new Float32Array(128)]], [[new Float32Array(128), new Float32Array(128)]]);
	assert.deepEqual(latencies(), [512, 768]);
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 2 }, ports: [peer()] });
	processor.process([[new Float32Array(128), new Float32Array(128)]], [[new Float32Array(128), new Float32Array(128)]]);
	assert.deepEqual(latencies(), [512, 768, 768], 'a replacement host establishes its own initial latency state');
});
