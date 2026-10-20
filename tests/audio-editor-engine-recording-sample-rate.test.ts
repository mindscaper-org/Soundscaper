/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';

test('requesting a recording rate creates and replaces idle contexts at that exact rate', async () => {
	const contexts: Array<{ sampleRate: number; state: string; closeCalls: number }> = [];
	const engine = createAudioEditorEngine({ audioContextFactory: (options?: AudioContextOptions) => {
		const context = {
			sampleRate: options?.sampleRate ?? 48_000,
			state: 'suspended', closeCalls: 0,
			async resume() { this.state = 'running'; },
			async close() { this.closeCalls += 1; this.state = 'closed'; },
		};
		contexts.push(context);
		return context as unknown as EngineAudioContext;
	} });
	const first = await engine.getAudioContext({ resume: false, sampleRate: 44_100 });
	assert.equal(first.sampleRate, 44_100);
	assert.equal(await engine.getAudioContext({ resume: false, sampleRate: 44_100 }), first);
	assert.equal((await engine.getAudioContext({ resume: false, sampleRate: 96_000 })).sampleRate, 96_000);
	assert.equal(contexts[0].closeCalls, 1);
	assert.equal((await engine.getAudioContext({ resume: false })).sampleRate, 96_000);
	await engine.dispose();
});

test('recording rate requests reject invalid or unsupported rates explicitly', async () => {
	const engine = createAudioEditorEngine({ audioContextFactory: () => ({
		sampleRate: 48_000, state: 'suspended', async close() {},
	}) as unknown as EngineAudioContext });
	await assert.rejects(() => engine.getAudioContext({ sampleRate: 123 }), RangeError);
	await assert.rejects(() => engine.getAudioContext({ sampleRate: 96_000 }), /96000/u);
	await engine.dispose();
});


test('concurrent context consumers see the new rate while the previous context closes', async () => {
	let finishClose!: () => void;
	const closing = new Promise<void>(resolve => { finishClose = resolve; });
	let created = 0;
	const engine = createAudioEditorEngine({ audioContextFactory: (options?: AudioContextOptions) => {
		const first = created++ === 0;
		return {
			sampleRate: options?.sampleRate ?? 48_000, state: 'suspended',
			close: () => first ? closing : Promise.resolve(),
		} as unknown as EngineAudioContext;
	} });
	await engine.getAudioContext({ resume: false });
	const replacement = engine.getAudioContext({ resume: false, sampleRate: 96_000 });
	assert.equal((await engine.getAudioContext({ resume: false })).sampleRate, 96_000);
	finishClose();
	assert.equal((await replacement).sampleRate, 96_000);
	await engine.dispose();
});

test('changing sample rate cannot orphan an active native plug-in instance', async (context) => {
	const { createNativePluginEffectNode, releaseNativePluginRuntime } = await import('../src/common/editor/native-plugin-realtime-node.js');
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	class FakeNode {
		port = { start() {}, postMessage() {}, close() {} };
		disconnect() {}
	}
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: FakeNode });
	context.after(() => {
		releaseNativePluginRuntime('rate-change-test');
		if (descriptor) Object.defineProperty(globalThis, 'AudioWorkletNode', descriptor);
		else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	});
	let closeCalls = 0;
	const engine = createAudioEditorEngine({ audioContextFactory: () => ({
		sampleRate: 48_000, state: 'suspended', async close() { closeCalls += 1; },
	}) as unknown as EngineAudioContext });
	const initial = await engine.getAudioContext({ resume: false });
	createNativePluginEffectNode(initial, { params: { instanceId: 'rate-change-test' } });
	await assert.rejects(() => engine.getAudioContext({ sampleRate: 96_000 }), /Remove native plug-in effects/u);
	assert.equal(await engine.getAudioContext({ resume: false }), initial);
	assert.equal(closeCalls, 0);
	await engine.dispose();
});
