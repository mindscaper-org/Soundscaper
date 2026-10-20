/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewAssistanceNativeGpuReceipt } from '../desktop/assistance-native-gpu-receipt.ts';

const device = Buffer.from('NVIDIA GeForce RTX 3090').toString('hex');
const receipt = `SOUNDSCAPER_GPU_COMPUTE_V1 provider=vulkan gpu=42 cpu=3 device=${device}`;

test('native compute evidence binds observed GPU work and device to its provider', () => {
	assert.deepEqual(reviewAssistanceNativeGpuReceipt(`startup log\r\n${receipt}\r\n`, 'vulkan'), {
		provider: 'vulkan', proof: 'ggml-compute', gpuWorkCount: 42, cpuWorkCount: 3,
		deviceName: 'NVIDIA GeForce RTX 3090',
	});
});

test('requested GPU, allocations, CPU-only, duplicate, and malformed receipts cannot prove execution', () => {
	for (const value of ['', 'using Vulkan0 backend', 'offloaded 30/30 layers to GPU',
		receipt.replace('gpu=42', 'gpu=0'), `${receipt}\n${receipt}`,
		receipt.replace('cpu=3', 'cpu=9007199254740993'), receipt.replace(device, 'ff'),
		receipt.replace(device, '00'), receipt.replace('provider=vulkan', 'provider=metal')]) {
		assert.throws(() => reviewAssistanceNativeGpuReceipt(value, 'vulkan'));
	}
});
