/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAutoTuneNode, ensureAutoTuneWorklet, disposeAutoTuneNode } from '../src/common/editor/engine/auto-tune-node.ts';
import { ensureProjectWorklets } from '../src/common/editor/engine/effect-worklets.ts';
import { supportsLiveRackEffectGesture } from '../src/common/editor/ui/inspector/live-rack-effect-gesture.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, createRackProject } from './helpers/audio-editor-runtime-harness.js';

function installGlobal(name: string, value: unknown): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	return () => {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	};
}

test('Auto-Tune preparation coalesces loads, retries failures, and admits every rack scope only when active', async () => {
	const bytes = await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url));
	let fetches = 0;
	const restoreFetch = installGlobal('fetch', (): Promise<Response> => { fetches++; return Promise.resolve(new Response(bytes)); });
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	try {
		const context = new MockAudioContext();
		const audioContext = context as unknown as BaseAudioContext;
		assert.throws(() => createAutoTuneNode(audioContext, MockAudioWorkletNode as unknown as typeof AudioWorkletNode, {}, 2), /not loaded/);
		await Promise.all([ensureAutoTuneWorklet(audioContext), ensureAutoTuneWorklet(audioContext)]);
		await ensureAutoTuneWorklet(audioContext);
		assert.equal(fetches, 1);
		assert.equal(context.audioWorkletModules.length, 1);
		let attempts = 0;
		const retry = new MockAudioContext();
		retry.audioWorklet.addModule = async (): Promise<void> => { if (++attempts === 1) throw new Error('module unavailable'); };
		await assert.rejects(ensureAutoTuneWorklet(retry as unknown as BaseAudioContext), /module unavailable/);
		await ensureAutoTuneWorklet(retry as unknown as BaseAudioContext);
		assert.equal(attempts, 2);
		for (const scope of ['track', 'master', 'group', 'send'] as const) {
			const scoped = new MockAudioContext();
			const owner = { id: 'owner', effectsActive: true, effects: [{ id: 'tune', type: 'auto-tune', enabled: false }] };
			const project = scope === 'track' ? { tracks: [owner] } : scope === 'master' ? { master: owner }
				: { mixer: { [scope === 'group' ? 'groups' : 'sends']: [owner] } };
			await ensureProjectWorklets(scoped as unknown as BaseAudioContext, project);
			assert.equal(scoped.audioWorkletModules.length, 0);
			owner.effects[0]!.enabled = true;
			owner.effectsActive = false;
			await ensureProjectWorklets(scoped as unknown as BaseAudioContext, project);
			assert.equal(scoped.audioWorkletModules.length, 0);
			owner.effectsActive = true;
			await ensureProjectWorklets(scoped as unknown as BaseAudioContext, project);
			assert.equal(scoped.audioWorkletModules.length, 1);
		}
	} finally { restoreNode(); restoreFetch(); }
});

test('Auto-Tune uses discrete channels, live revisions and idempotent cleanup through engine stop', async () => {
	const bytes = await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url));
	const restoreFetch = installGlobal('fetch', (): Promise<Response> => Promise.resolve(new Response(bytes)));
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
	try {
		engine.loadProject(createRackProject({ tracks: [{ id: 'track-1', effects: [{ id: 'tune', type: 'auto-tune', params: {} }] }] }),
			new Map([['source-1', new MockAudioBuffer(2, 4800, 48000) as unknown as AudioBuffer]]));
		await engine.play();
		const node = context.workletNodes.find(candidate => candidate.name === 'kw-auto-tune');
		assert.ok(node);
		assert.equal(node.options.channelInterpretation, 'discrete');
		assert.equal(node.options.channelCountMode, 'explicit');
		assert.ok(node.options.processorOptions.staffPadWasmModule instanceof WebAssembly.Module);
		assert.equal(supportsLiveRackEffectGesture({ type: 'auto-tune' }, {}), true);
		assert.equal(engine.configureRackEffect('track', 'track-1', 'tune', { mix: 0, key: 'a' }), 1);
		assert.equal(engine.configureRackEffect('track', 'track-1', 'tune', { amount: 0 }), 2);
		assert.throws(() => engine.configureRackEffect('track', 'track-1', 'tune', { mix: -1 }), RangeError);
		assert.equal(node.messages.length, 2);
		engine.stop();
		disposeAutoTuneNode(node as unknown as AudioNode);
		assert.deepEqual(node.messages.at(-1), { type: 'dispose' });
		assert.equal(node.messages.length, 3);
		assert.equal(node.disconnected, true);
	} finally { await engine.dispose(); restoreNode(); restoreFetch(); }
});

test('Auto-Tune refuses unavailable AudioWorklets without silently bypassing processing', async () => {
	const restore = installGlobal('AudioWorkletNode', undefined);
	try {
		await assert.rejects(ensureProjectWorklets({} as BaseAudioContext,
			{ tracks: [{ effects: [{ type: 'auto-tune' }] }] }), /cannot run Auto-Tune/);
	} finally { restore(); }
});
