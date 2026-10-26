/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureProjectWorklets } from '../src/common/editor/engine/effect-worklets.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, createRackProject } from './helpers/audio-editor-runtime-harness.js';

for (const [pitchShift, mix] of [[0, 1], [2, 0], [2, 1]] as const) test(`native delay ${pitchShift} semitones, mix${mix} loads only its required runtime`, async () => {
	const originalNode = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	const originalFetch = globalThis.fetch;
	let wasmRequests = 0;
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: MockAudioWorkletNode });
	globalThis.fetch = async input => {
		assert.match(String(input), /staffpad\.wasm$/u);
		wasmRequests++;
		return new Response(null, { status: 503, statusText: 'Unavailable' });
	};
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext, meterInterval: 1000 });
	try {
		engine.loadProject(createRackProject({ tracks: [{ id: 'track-1', effects: [{ id: 'delay', type: 'multi-tap-delay',
			params: { time: .02, echoes: 2, echoGain: -6, pitchShift, mix } }] }] }),
		new Map([['source-1', new MockAudioBuffer(2, 4800, 48_000) as unknown as AudioBuffer]]));
		if (pitchShift && mix) {
			await assert.rejects(engine.play(), /Unable to load StaffPad WASM \(503/u);
			assert.equal(wasmRequests, 1);
			assert.notEqual(engine.getState().state, 'playing', 'required native pitch cannot be bypassed');
		} else {
			await engine.play();
			assert.equal(wasmRequests, 0, 'unpitched or dry delay has no native pitch dependency');
			assert.equal(engine.getState().state, 'playing');
			assert.equal(context.workletNodes.length, 1);
			assert.equal(context.workletNodes[0]?.name, 'kw-standard-effect');
			const next = { pitchShift: 2, mix: 1 };
			assert.equal(engine.configureRackEffect('track', 'track-1', 'delay', next), false, 'native-pitch activation must rebuild its changed compensation');
			assert.equal(wasmRequests, 0);
			assert.deepEqual(context.workletNodes[0]?.messages, [], 'the old worklet cannot receive an unavailable native runtime');
		}
	} finally {
		await engine.dispose(); globalThis.fetch = originalFetch;
		if (originalNode) Object.defineProperty(globalThis, 'AudioWorkletNode', originalNode);
		else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	}
});

for (const scope of ['track', 'group', 'send', 'cue', 'master'] as const) test(`pitched runtime admission respects active ${scope} racks`, async () => {
	const originalNode = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	const originalFetch = globalThis.fetch;
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: MockAudioWorkletNode });
	let requests = 0;
	globalThis.fetch = async () => { requests++; return new Response(null, { status: 503 }); };
	try {
		for (const mode of ['unpitched', 'dry', 'disabled', 'bypassed', 'rack-off', 'pitched'] as const) {
			const effect = { id: 'delay', type: 'multi-tap-delay', enabled: mode !== 'disabled', bypassed: mode === 'bypassed',
				params: { pitchShift: mode === 'unpitched' ? 0 : 2, mix: mode === 'dry' ? 0 : 1 } };
			const owner = { id: 'owner', effectsActive: mode !== 'rack-off', effects: [effect] };
			const project: EngineProject = { sampleRate: 48_000, tracks: scope === 'track' ? [{ ...owner, type: 'audio' }] : [],
				master: scope === 'master' ? owner : { effects: [] }, mixer: { groups: scope === 'group' ? [owner] : [],
					sends: scope === 'send' ? [owner] : [], cues: scope === 'cue' ? [owner] : [] } };
			const before = requests;
			const context = new MockAudioContext() as unknown as BaseAudioContext;
			if (mode === 'pitched') {
				await assert.rejects(ensureProjectWorklets(context, project), /Unable to load StaffPad WASM/u);
				assert.equal(requests, before + 1, mode);
			} else { await ensureProjectWorklets(context, project); assert.equal(requests, before, mode); }
		}
	} finally {
		globalThis.fetch = originalFetch;
		if (originalNode) Object.defineProperty(globalThis, 'AudioWorkletNode', originalNode);
		else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	}
});
