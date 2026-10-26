/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createFramescaperOpenFxPlanCurrentProjectAuthority } from '../desktop/framescaper-openfx-frame-registration.mjs';
import { createNativePluginHostJobRunner, HOST_PROBE_BLOCKS } from '../desktop/native-helper-host-job.js';

test('admitted canonical OpenFX plan identity retains exact saved schema and authored effect checks', async () => {
	const effect = { instanceId: 'effect', pluginId: 'org.example.Filter' };
	const document = { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', revision: 7, ofxEffects: [effect] };
	const current = createFramescaperOpenFxPlanCurrentProjectAuthority({ schemaFamily: 'framescaper', schemaVersion: 1,
		projectRecord: () => ({ schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project', projectRevision: 7, projectSha256: 'ab'.repeat(32) }),
		readProjectBundle: async () => ({ project: { schemaFamily: 'framescaper', schemaVersion: 1, projectRevision: 7, sha256: 'ab'.repeat(32) }, document: JSON.stringify(document) }),
	});
	assert.equal(await current({ id: 'project', revision: 7 }, effect), true);
	assert.equal(await current({ id: 'project', revision: 6 }, effect), false);
	assert.equal(await current({ schemaFamily: 'soundscaper', schemaVersion: 1, id: 'project', revision: 7 }, effect), false);
	assert.equal(await current({ id: 'project', revision: 7 }, { ...effect, pluginId: 'different' }), false);
});

test('offline plug-in probes use the opened instance input and output topology', async () => {
	for (const [inputChannels, outputChannels] of [[1, 1], [2, 6], [6, 2], [32, 32]] as const) {
		let blocks = 0; let closed = false;
		const instance = Object.freeze({});
		const addon = {
			openPluginInstance: () => instance, pluginLatencyFrames: () => 0,
			pluginAudioTopology(value: unknown) { assert.equal(value, instance); return { inputChannels, outputChannels }; },
			processPluginBlock(value: unknown, frames: number, input: Float32Array[], output: Float32Array[]) {
				assert.equal(value, instance); assert.equal(input.length, inputChannels); assert.equal(output.length, outputChannels);
				for (let channel = 0; channel < outputChannels!; channel += 1) output[channel]!.set(input[channel % inputChannels!]!);
				assert.equal(frames, 256); blocks += 1;
			},
			savePluginState: () => new Uint8Array(0), closePluginInstance() { closed = true; },
		};
		const run = createNativePluginHostJobRunner({ addonPath: '/host', addonSha256: 'ab'.repeat(32), loadAddon: async () => addon,
			hashFile: async () => ({ byteLength: 16, sha256: 'cd'.repeat(32) }), hash: () => createHash('sha256') });
		const result = await run({ grant: { binaryPath: '/plugin', binaryBytes: 16, binarySha256: 'cd'.repeat(32), format: 'clap', stableId: 'org.example.effect', identity: { dev: 1, ino: 2 } }, onProgress() {} }).completion;
		assert.equal(blocks, HOST_PROBE_BLOCKS); assert.equal(result.blocksRendered, HOST_PROBE_BLOCKS); assert.equal(closed, true);
	}
});
