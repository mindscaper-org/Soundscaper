/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeDeviceIoWorkletNode } from '../src/common/editor/native-device-io-worklet-node.js';

for (const direction of ['input', 'output', 'duplex'] as const) for (const channelCount of [1, 2, 6]) {
	test(`native ${direction} ${channelCount}-channel route keeps capture planes and folds only mono playback input`, async () => {
		let settings: AudioWorkletNodeOptions | null = null;
		class Node {
			readonly port = { onmessage: null, start() {}, postMessage() {} };
			constructor(_context: unknown, _name: string, options: AudioWorkletNodeOptions) { settings = options; }
			disconnect() {}
		}
		const transport = await createNativeDeviceIoWorkletNode({ audioWorklet: { addModule: async () => {} } }, {
			direction, channelCount, periodFrames: 128, queueCapacity: 8, AudioWorkletNode: Node,
		});
		try {
			const actual = settings as AudioWorkletNodeOptions | null;
			assert.ok(actual);
			assert.equal(actual.numberOfInputs, direction === 'input' ? 0 : 1);
			assert.deepEqual(actual.outputChannelCount, [channelCount], 'native capture/output planes retain their physical geometry');
			assert.deepEqual(actual.processorOptions, { direction, channelCount, periodFrames: 128, queueCapacity: 8 });
			if (direction !== 'input' && channelCount === 1) {
				assert.equal(actual.channelCount, 1);
				assert.equal(actual.channelCountMode, 'explicit');
				assert.equal(actual.channelInterpretation, 'speakers');
			} else {
				assert.equal(actual.channelCount, undefined);
				assert.equal(actual.channelCountMode, undefined);
				assert.equal(actual.channelInterpretation, undefined);
			}
		} finally { transport.dispose(); }
	});
}
