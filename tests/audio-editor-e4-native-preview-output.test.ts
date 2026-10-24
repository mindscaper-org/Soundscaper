/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { createSoundscaperNativeAudioRenderer, soundscaperNativeAudioDestination } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { MockAudioContext, MockNode } from './helpers/mock-audio-context.js';

interface ListeningNode { connections: ListeningNode[]; gain?: { value: number } }

for (const native of [false, true]) for (const audition of [false, true]) {
	test(`preview retains the chosen output, native=${native}, frequency audition=${audition}`, async () => {
		const context = new MockAudioContext();
		const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
		const host = engine as unknown as EngineRuntimeHost;
		const listener: { receive: ((event: Event) => void) | null } = { receive: null };
		const nativeWindow = {} as Window;
		const device = context.createGain();
		const renderer = createSoundscaperNativeAudioRenderer({
			engine,
			windowValue: {
				window: nativeWindow,
				addEventListener: (_type: string, receive: EventListenerOrEventListenerObject) => {
					listener.receive = receive as (event: Event) => void;
				},
				removeEventListener() {},
			} as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
			createNode: async () => ({
				node: device as unknown as AudioNode,
				attach: (_port, value) => value.generation,
				revoke: () => 1, notifyPeerLoss: () => 1, calibrate: async () => 0, dispose() {},
			}),
		});
		try {
			await engine.getAudioContext();
			if (native) {
				await renderer.prepare('output', {
					candidates: [{ backend: 'alsa', deviceHandle: 'speakers' }], direction: 'output', mode: 'shared',
					sampleRate: 48_000, periodFrames: 128, channelCount: 2,
				});
				listener.receive?.({
					source: nativeWindow,
					data: { type: 'soundscaper-native-realtime-port-v1', offer: {
						protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48_000,
						channelCount: 2, frameCount: 128, queueCapacity: 8, startFrame: 0,
					} }, ports: [{ close() {} }],
				} as unknown as Event);
				await renderer.waitForPort('output');
			}
			const expected = native ? device : context.destination;
			assert.equal(soundscaperNativeAudioDestination(context as unknown as EngineAudioContext,
				context.destination as unknown as AudioNode), expected);
			const meter = new MockNode('meter');
			host.masterLoudnessMeter = {
				node: meter as unknown as AudioNode,
				setRunning() {}, reset() {}, requestSnapshot() {}, dispose() {},
			};
			if (audition) engine.setPlaybackFrequencyRange({ minimumFrequency: 100, maximumFrequency: 1000 });
			engine.setPlaybackGain(.25);
			const output = engine.getPlaybackDestination();
			assert.equal((output as unknown as ListeningNode).gain?.value, .25);
			assert.equal(listeningDestination(output, device, context.destination), expected);
			assert.equal(meter.connections[0], output, 'LUFS metering remains before listening gain/filter');
			assert.equal(engine.getPlaybackDestination(), output, 'a preview must retain the programme listening node');
			engine.setPlaybackGain(.5);
			assert.equal((output as unknown as ListeningNode).gain?.value, .5);
			await renderer.release('output');
			assert.equal(listeningDestination(engine.getPlaybackDestination(), device, context.destination), context.destination);
			assert.equal(meter.connections[0], engine.getPlaybackDestination());
		} finally {
			await renderer.dispose();
			await engine.dispose();
		}
	});
}

function listeningDestination(output: AudioNode, native: object, browser: object): ListeningNode {
	let node = output as unknown as ListeningNode;
	while (node !== native && node !== browser && node.connections[0]) node = node.connections[0];
	return node;
}
