/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroAudioInputResolver } from '../src/common/editor/controller/effects/macro-audio-input-service.ts';

test('reference files are picked once per batch, read in bounded slices and decoded at each project rate', async () => {
	let picked = 0, released = 0;
	const sizes: number[] = [], rates: number[] = [];
	const size = 6 * 1024 * 1024;
	const resolve = createMacroAudioInputResolver({ isDesktop: true,
		chooseFiles: async () => { picked += 1; return [{}]; },
		withReadDescriptors: async (_descriptors, _options, consume) => {
			try { return await consume([{ name: 'jingle.wav', size, arrayBuffer: async () => { throw new Error('Whole-file reads forbidden'); },
				slice: (start, end) => ({ arrayBuffer: async () => { sizes.push(end - start); return new ArrayBuffer(end - start); } }),
			}]); } finally { released += 1; }
		},
	}, async (bytes, sampleRate) => {
		rates.push(sampleRate); assert.equal(bytes.byteLength, size);
		return { sampleRate, numberOfChannels: 1, getChannelData: () => new Float32Array(128) };
	});
	await resolve('jingle', 1000, new AbortController().signal);
	await resolve('jingle', 2000, new AbortController().signal);
	assert.equal(picked, 1); assert.equal(released, 1); assert.deepEqual(rates, [1000, 2000]);
	assert.ok(sizes.every(length => length <= 1024 * 1024));
});
