/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MessageChannel, type MessagePort } from 'node:worker_threads';

import type { NativeMainMessagePort } from '../../../desktop/native-audio-helper-adapter.ts';
import { createNativePersistentPluginJobRunner } from '../../../desktop/native-helper-persistent-plugin-job.js';
import { openNativePersistentPluginSession } from '../../../desktop/native-plugin-helper-adapter.ts';
import { DesktopPluginRegistry } from '../../../desktop/plugin-registry.ts';
import { createTracktionPluginLibrary } from '../../../desktop/tracktion-plugin-library.ts';
import { openTracktionProfessionalEffect } from '../../../desktop/tracktion-professional-effect-host.ts';

const effect = { format: 'clap', stableId: 'org.soundscaper.fixture.tracktion-gain', sha256: 'a'.repeat(64) } as const;
const binaryPath = join(tmpdir(), 'tracktion-fixture.clap');

test('Tracktion attaches only exact stereo effect installations admitted by the desktop registry', async () => {
	const blocked = new Set<string>();
	const registry = new DesktopPluginRegistry({ isQuarantined: (digest) => blocked.has(digest) });
	const admission = registry.record({
		format: effect.format, stableId: effect.stableId, bundleStableIds: [effect.stableId],
		platform: process.platform, architecture: process.arch, name: 'Gain', vendor: 'Fixture', version: '1.0.0',
		binaryPath, binaryBytes: 32, binarySha256: effect.sha256, identity: { dev: 1, ino: 2 },
		classification: 'effect', topologies: [{ inputChannels: 2, outputChannels: 2 }],
		realtimeSupported: true, offlineSupported: true, reportedLatencyFrames: 0,
		compatibility: 'compatible', descriptorVersion: 3,
	});
	assert.ok(admission.status === 'recorded');
	const { installationId } = admission;
	let enabled = true;
	let confirmed = false;
	let authenticated = true;
	let prompts = 0;
	let opened = 0;
	const library = createTracktionPluginLibrary({
		registry, prepareCatalog: async () => undefined, rebind: async () => authenticated,
		scan: async () => undefined, isEnabled: () => enabled, isFormatActive: (format) => format === 'clap',
		authorize: async ({ id }) => {
			prompts += 1;
			if (confirmed) registry.allow(id);
		},
		open: async (id, rate, frames) => {
			opened += 1;
			assert.deepEqual([id, rate, frames], [installationId, 48_000, 128]);
			return { latencyFrames: 0, async process() {}, async close() {} };
		},
	});
	assert.deepEqual(await library.catalog(), [{ id: installationId, name: 'Gain', vendor: 'Fixture', format: 'clap', allowed: false }]);
	const { signal } = new AbortController();
	assert.equal(await library.openStereo(effect, 48_000, 128), null);
	assert.equal(prompts, 0, 'reopening a project or exporting cannot prompt for or grant execution');
	assert.equal(await library.select(installationId, signal), null);
	confirmed = true;
	assert.deepEqual(await library.select(installationId, signal), effect);
	assert.equal(prompts, 2);
	assert.equal((await library.catalog())[0]?.allowed, true);
	assert.ok(await library.openStereo(effect, 48_000, 128));
	authenticated = false;
	await assert.rejects(library.select(installationId, signal), /could not be verified/u);
	assert.equal(await library.openStereo(effect, 48_000, 128), null);
	authenticated = true;
	assert.equal(await library.openStereo({ ...effect, sha256: 'b'.repeat(64) }, 48_000, 128), null);
	assert.equal(await library.openStereo({ ...effect, format: 'vst3' }, 48_000, 128), null);
	blocked.add(effect.sha256);
	assert.equal(await library.openStereo(effect, 48_000, 128), null);
	assert.deepEqual(await library.catalog(), []);
	blocked.clear();
	enabled = false;
	assert.equal(await library.openStereo(effect, 48_000, 128), null);
	assert.equal(opened, 1);
});

test('Tracktion processes audio on the production helper RPC and refuses a changed latency', async () => {
	let hostClosed = false;
	let latency = 32;
	const runner = createNativePersistentPluginJobRunner({
		addonPath: binaryPath, addonSha256: effect.sha256,
		hashFile: async () => ({ byteLength: 32, sha256: effect.sha256 }),
		loadAddon: async () => ({
			async openPluginInstance() { return {}; },
			async pluginLatencyFrames() { return latency; },
			pluginAudioTopology() { return { inputChannels: 2, outputChannels: 2 }; },
			async processPluginBlock(_instance: unknown, _frames: number, input: readonly Float32Array[], output: readonly Float32Array[]) {
				for (const [index, source] of input.entries()) output[index]!.set(source.map((sample) => sample * 2));
			},
			async closePluginInstance() { hostClosed = true; },
		}),
	});
	const session = await openNativePersistentPluginSession({
		createChannel: () => {
			const { port1, port2 } = new MessageChannel();
			return { port1: mainPort(port1), port2: mainPort(port2) };
		},
		grant: {
			format: 'clap', stableId: effect.stableId, binaryPath, binaryBytes: 32, binarySha256: effect.sha256,
			identity: { dev: 1, ino: 2 },
		},
		sampleRate: 48_000, maximumFrames: 128,
		supervisor: {
			async runJob(request) {
				const job = runner({ grant: request.grant, ports: request.dataPlaneTransfers?.map(({ port }) => port) ?? [],
					resourcePolicy: request.resourcePolicy });
				const cancel = () => { void job.cancel(); };
				request.signal?.addEventListener('abort', cancel, { once: true });
				try { return await job.completion; }
				finally { request.signal?.removeEventListener('abort', cancel); }
			},
		},
	});
	const processor = await openTracktionProfessionalEffect(session);
	assert.ok(processor);
	try {
		const input = [Float32Array.of(0.25, 0.3), Float32Array.of(-0.125, 0.1)] as const;
		const output = [new Float32Array(2), new Float32Array(2)] as const;
		assert.equal(processor.latencyFrames, 32);
		await processor.process(input, output);
		assert.deepEqual(output, [Float32Array.of(0.5, 0.6), Float32Array.of(-0.25, 0.2)]);
		latency = 128;
		await assert.rejects(processor.process(input, output), /changed its latency/u);
	} finally {
		await processor.close();
	}
	assert.equal(hostClosed, true);
});

function mainPort(port: MessagePort): NativeMainMessagePort {
	return {
		postMessage: (message) => port.postMessage(message),
		start: () => port.start(),
		close: () => port.close(),
		on: (event, listener) => { port.on(event, listener); },
		off: (event, listener) => { port.off(event, listener); },
	};
}
