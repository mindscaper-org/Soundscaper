/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
import test from 'node:test';
import { createNativePersistentPluginJobRunner } from '../desktop/native-helper-persistent-plugin-job.js';

test('the admitted native port delivers MIDI before PCM and rejects an out-of-block event before vendor code', async () => {
	const channel = new MessageChannel();
	const calls: unknown[] = [];
	let closed = 0;
	const runner = createNativePersistentPluginJobRunner({ addonPath: '/host.node', addonSha256: 'a'.repeat(64),
		hashFile: async () => ({ sha256: 'a'.repeat(64), byteLength: 1 }),
		loadAddon: async () => ({
			openPluginInstance: async () => ({}), pluginLatencyFrames: async () => 0,
			pluginMidiEvents: async (_instance: unknown, frames: number, events: unknown) => { calls.push({ frames, events }); },
			processPluginBlock: async (_instance: unknown, _frames: number, _input: unknown, output: Float32Array[]) => {
				calls.push('pcm'); output[0]![1] = 0.75;
			}, closePluginInstance: async () => { closed++; },
		}),
	});
	const job = runner({ grant: { persistentPort: { streamId: 'stream' }, format: 'vst3', binaryPath: '/synth.vst3', binaryBytes: 1, binarySha256: 'a'.repeat(64) },
		ports: [channel.port1], resourcePolicy: {} });
	async function request(value: Record<string, unknown>) {
		const response = once(channel.port2, 'message');
		channel.port2.postMessage({ protocolVersion: 1, ...value });
		return (await response)[0] as Record<string, unknown>;
	}
	try {
		assert.equal((await request({ kind: 'configure', sampleRate: 8000, maximumFrames: 4, stateAuthenticationKey: 'b'.repeat(64) })).kind, 'configured');
		const events = [{ frame: 1, data: [0x94, 60, 99] }];
		const answer = await request({ kind: 'process-midi', requestId: 'block-1', frameCount: 4, input: [], output: [new Float32Array(4)], events });
		assert.equal(answer.kind, 'processed');
		assert.deepEqual([...(answer.output as Float32Array[])[0]!], [0, 0.75, 0, 0]);
		assert.deepEqual(calls, [{ frames: 4, events }, 'pcm']);
		const fault = await request({ kind: 'process-midi', requestId: 'bad-block', frameCount: 4, input: [], output: [new Float32Array(4)], events: [{ frame: 4, data: [0x90, 60, 99] }] });
		assert.equal(fault.kind, 'fault');
		await job.completion;
		assert.equal(closed, 1);
		assert.equal(calls.length, 2);
	} finally { await job.cancel(); channel.port1.close(); channel.port2.close(); }
});
