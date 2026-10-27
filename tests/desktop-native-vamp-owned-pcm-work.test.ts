/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import test from 'node:test';
import { DesktopVampAnalyzerRegistry, type VampAnalyzerLibraryObservation } from '../desktop/vamp-analyzer-registry.ts';
import { DesktopVampAnalyzerSessions } from '../desktop/vamp-analyzer-session.ts';
import { createNativeVampAnalyzerBackendFactory } from '../desktop/native-vamp-analyzer-helper-backend.ts';
import { createNativePersistentVampAnalyzerJobRunner } from '../desktop/native-helper-persistent-vamp-analyzer-job.js';

const observation: VampAnalyzerLibraryObservation = {
	kind: 'analyzer-library', format: 'vamp', libraryPath: '/usr/lib/vamp/events.so',
	libraryBytes: 4096, librarySha256: 'c'.repeat(64), identity: { dev: 1, ino: 2 },
	platform: 'linux', architecture: 'x64', compatibility: 'compatible', descriptors: [{
		kind: 'analyzer', format: 'vamp', identifier: 'events', name: 'Events', description: '', maker: 'Example', copyright: '',
		pluginVersion: 1, vampApiVersion: 2, inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
		preferredStepSize: 512, preferredBlockSize: 1024, parameters: [], programs: [], outputs: [{
			identifier: 'events', name: 'Events', description: '', unit: '', binCount: 1, binNames: [], extents: null,
			quantizeStep: null, sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false,
		}],
	}],
};

test('the real session and persistent native helper transfer only private PCM capture once', async (context) => {
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const recorded = registry.recordLibrary(observation);
	assert.equal(recorded.status, 'recorded');
	if (recorded.status !== 'recorded') throw new Error('recording failed');
	const installationId = recorded.analyzers[0]!.installationId; registry.allow(installationId);
	let observedPlanes: readonly Float32Array[] = [];
	const run = createNativePersistentVampAnalyzerJobRunner({ addonPath: '/unused', addonSha256: 'a'.repeat(64),
		hashFile: async () => ({ sha256: observation.librarySha256, byteLength: 4096, identity: observation.identity }),
		loadAddon: async () => ({ openExactAnalyzer: async () => 1,
			configureAnalyzer: async () => ({ outputs: observation.descriptors[0]!.outputs }),
			processAnalyzerPcm: async (_instance: number, chunk: { channels: readonly Float32Array[] }) => {
				observedPlanes = chunk.channels;
				return [{ outputId: 'events', timestamp: { seconds: 0, nanoseconds: 0 }, duration: null, values: [0.5], label: 'event' }];
			}, finishAnalyzer: async () => [], closeAnalyzer: async () => {}, cancelAnalyzer: async () => {} }),
	});
	const backend = createNativeVampAnalyzerBackendFactory({ createChannel: () => {
			const channel = new MessageChannel();
			return { port1: channel.port1 as never, port2: channel.port2 as never };
		},
		supervisorFor: () => {
			let handle: ReturnType<typeof run> | undefined;
			return { runJob(request) {
				handle = run({ grant: request.grant, ports: request.dataPlaneTransfers?.map(({ port }) => port) ?? [], resourcePolicy: request.resourcePolicy });
				request.signal?.addEventListener('abort', () => { void handle?.cancel(); }, { once: true });
				return handle.completion;
			}, dispose() { void handle?.cancel(); } };
		} });
	const sessions = new DesktopVampAnalyzerSessions({ registry, backend, mintSessionId: () => 'vamp_owned_01' });
	context.after(() => sessions.dispose());
	const owner = {};
	const started = await sessions.start(owner, { installationId, sessionId: null });
	await sessions.configure(owner, { sessionId: started.sessionId, sampleRate: 48000, channelCount: 2,
		stepSize: 512, blockSize: 1024, frameCount: 65536, parameters: {}, program: null });
	const channels = [new Float32Array(65536).fill(0.25), new Float32Array(65536).fill(-0.25)];
	let copies = 0;
	const original = Float32Array.from;
	context.mock.method(Float32Array, 'from', (value: ArrayLike<number>) => {
		if (value instanceof Float32Array) copies += 1;
		return Reflect.apply(original, Float32Array, [value]) as Float32Array;
	});
	const result = await sessions.pushPcm(owner, { sessionId: started.sessionId, startFrame: 0, channels });
	assert.equal(copies, 2);
	assert.deepEqual(observedPlanes, channels);
	assert.equal(channels[0]!.byteLength, 65536 * 4);
	assert.equal(result.features[0]!.values[0], 0.5);
	await sessions.finish(owner, { sessionId: started.sessionId });
});
