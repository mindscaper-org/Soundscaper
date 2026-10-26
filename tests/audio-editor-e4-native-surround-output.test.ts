/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperNativeAudioRenderer, soundscaperNativeAudioOutputChannelCount } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import { connectSurroundMonitoring } from '../src/common/editor/surround-monitoring.ts';
import { MockAudioContext, MockNode } from './helpers/mock-audio-context.js';

for (const [defaultWidth, nativeWidth, programmeWidth] of [[6, 2, 6], [2, 6, 6], [2, 8, 8], [2, 2, 6], [2, 1, 2], [2, 1, 6]] as const) {
	test(`monitoring uses native width ${nativeWidth} for programme ${programmeWidth}, default hardware ${defaultWidth}`, async () => {
		const context = Object.assign(new MockAudioContext(), {
			createChannelSplitter: () => new MockNode('splitter'), createChannelMerger: () => new MockNode('merger'),
		});
		Object.assign(context.destination, { maxChannelCount: defaultWidth, channelCount: 2 });
		const source = context.createGain(), device = context.createGain(), listening = context.createGain();
		listening.connect(device);
		const nativeWindow = {} as Window;
		const listener: { receive: ((event: Event) => void) | null } = { receive: null };
		const renderer = createSoundscaperNativeAudioRenderer({
			engine: { getAudioContext: async () => context as unknown as AudioContext,
				getState: () => ({ state: 'stopped' }), pause() {}, play: async () => {} },
			windowValue: { window: nativeWindow,
				addEventListener: (_type: string, receive: EventListenerOrEventListenerObject) => {
					listener.receive = receive as (event: Event) => void;
				}, removeEventListener() {},
			} as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
			createNode: async () => ({ node: device as unknown as AudioNode,
				attach: (_port, value) => value.generation, revoke: () => 1,
				notifyPeerLoss: () => 1, calibrate: async () => 0, dispose() {},
			}),
		});
		try {
			await renderer.prepare('selected-output', {
				candidates: [{ backend: 'alsa', deviceHandle: 'chosen' }], direction: 'output', mode: 'shared',
				sampleRate: 48_000, periodFrames: 128, channelCount: nativeWidth,
			});
			assert.equal(soundscaperNativeAudioOutputChannelCount(context as unknown as BaseAudioContext), null, 'preparing does not publish an unattached width');
			listener.receive?.({ source: nativeWindow, data: { type: 'soundscaper-native-realtime-port-v1', offer: {
				protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48_000,
				channelCount: nativeWidth, frameCount: 128, queueCapacity: 8, startFrame: 0,
			} }, ports: [{ close() {} }] } as unknown as Event);
			await renderer.waitForPort('selected-output');
			assert.equal(soundscaperNativeAudioOutputChannelCount(context as unknown as BaseAudioContext), nativeWidth);
			const nodes: AudioNode[] = [];
			assert.equal(connectSurroundMonitoring(context as unknown as BaseAudioContext, source as unknown as AudioNode,
				listening as unknown as AudioNode, programmeWidth, nodes), programmeWidth <= 2 ? 'direct' : nativeWidth >= programmeWidth ? 'native' : 'stereo-fallback');
			assert.equal((context.destination as unknown as { channelCount: number }).channelCount, 2,
				'the unselected default device must not be reconfigured');
			assert.equal(nodes.length, programmeWidth <= 2 || nativeWidth >= programmeWidth ? 0 : 8);
			await renderer.release('selected-output');
			assert.equal(soundscaperNativeAudioOutputChannelCount(context as unknown as BaseAudioContext), null);
			const freshSource = context.createGain();
			assert.equal(connectSurroundMonitoring(context as unknown as BaseAudioContext, freshSource as unknown as AudioNode,
				context.destination as unknown as AudioNode, programmeWidth, []), programmeWidth <= 2 ? 'direct' : defaultWidth >= programmeWidth ? 'native' : 'stereo-fallback');
		} finally { await renderer.dispose(); }
	});
}
