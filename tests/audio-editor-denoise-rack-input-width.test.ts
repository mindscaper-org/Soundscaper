/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createAiDenoiseNode, prepareAiDenoise } from '../src/common/editor/engine/ai-denoise-runtime.ts';
import { effectGraphKey } from '../src/common/editor/engine/effect-rack-node-registry.ts';

for (const scope of ['clip', 'track', 'group'] as const) test(`AI denoising prepares the input before and after a ${scope} reverb`, async context => {
	// Isolate the authenticated stream transport, without substituting any DSP or
	// claiming to exercise a GPU model. Preparation must agree with graph geometry.
	const ports: import('node:worker_threads').MessagePort[] = [];
	class Worklet extends EventTarget {
		readonly port;
		constructor() {
			super(); const pair = new MessageChannel(); ports.push(pair.port1, pair.port2);
			this.port = pair.port1;
			pair.port2.onmessage = event => { if (event.data?.type === 'attach') pair.port2.postMessage({ type: 'attached' }); };
		}
		disconnect() {}
	}
	const ctx = Object.assign(new EventTarget(), { sampleRate: 48000, state: 'running', audioWorklet: { addModule: async () => {} } }) as unknown as BaseAudioContext;
	const globals = { AudioWorkletNode: Worklet, scapeDesktop: {}, window: { location: { origin: 'https://soundscaper.test' },
		postMessage(_message: unknown, _origin: string, transfers: import('node:worker_threads').MessagePort[]) {
			ports.push(...transfers); transfers[0]!.postMessage({ type: 'ready' });
		} } };
	const descriptors = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	context.after(() => {
		Reflect.set(ctx, 'state', 'closed'); ctx.dispatchEvent(new Event('statechange'));
		for (const port of ports) port.close();
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
	});
	for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	const effects = [createEffect('ai-denoise', { id: 'before' }), createEffect('reverb', { id: 'stereo' }), createEffect('ai-denoise', { id: 'after' })];
	const project = createSoundscaperProject({ sampleRate: 48000, sources: [{ id: 'source', frameCount: 512, sampleRate: 48000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 512, ...(scope === 'clip' ? { effects } : {}) }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'], ...(scope === 'track' ? { effects } : {}) }],
	});
	const rendered = scope === 'group' ? { ...project, mixer: { ...project.mixer, groups: [{ id: 'bus', channelCount: 1, effects }] } } : project;
	await prepareAiDenoise(ctx, rendered);
	const target = scope === 'clip' ? 'clip' : scope === 'track' ? 'voice' : 'bus';
	assert.doesNotThrow(() => createAiDenoiseNode(ctx, effectGraphKey(scope, target, 'before'), 1));
	assert.doesNotThrow(() => createAiDenoiseNode(ctx, effectGraphKey(scope, target, 'after'), 2));
});
