/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AudioBuffer as NativeAudioBuffer } from 'node-web-audio-api';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { selectionWav } from './helpers/selection-controller-custody.tsx';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createNodeWebAudioEngineFactory, type NodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

type Controller = Awaited<ReturnType<typeof controllerSession>>['controller'];
type Store = Awaited<ReturnType<typeof controllerSession>>['store'];
const FRAMES = 38_400;

/** Load the current production-owned buffers exactly as a fresh export renderer does. */
async function renderCurrent(controller: Controller, store: Store, backend: NodeWebAudioEngineFactory) {
	const project = clipboardProject(controller.project);
	const renderer = backend.createEngine();
	try {
		const buffers = new Map<string, AudioBuffer>();
		for (const source of project.sources) {
			assert.ok(source.kind === 'audio');
			const clip = project.clips.find(value => value.sourceId === source.id); if (!clip) continue;
			const visual = controller.getClipVisualData(clip.id);
			const buffer = visual?.buffer ?? await store.loadSourceAudioBuffer(source.storageKey, await renderer.getAudioContext({ resume: false }));
			assert.ok(buffer instanceof NativeAudioBuffer);
			buffers.set(source.id, buffer);
		}
		renderer.loadProject(projectForRuntimeConsumers(project), buffers);
		const output = await renderer.renderMix({ startFrame: 0, endFrame: FRAMES });
		assert.ok(output instanceof NativeAudioBuffer);
		assert.deepEqual([output.length, output.numberOfChannels, output.sampleRate], [FRAMES, 2, 48_000]);
		return Array.from({ length: 2 }, (_, channel) => {
			const pcm = new Float32Array(FRAMES); output.copyFromChannel(pcm, channel); return pcm;
		});
	} finally { await renderer.dispose(); }
}

function assertScaled(actual: readonly Float32Array[], reference: readonly Float32Array[], factor: number) {
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < FRAMES; frame++) {
		const expected = reference[channel]![frame]! * factor;
		assert.ok(Math.abs(actual[channel]![frame]! - expected) < 1e-7,
			`independent scalar at channel ${channel}, frame ${frame}`);
	}
}

test('the real Node backend renders shipping fades, controller Invert and the shipping EQ WASM', { timeout: 25_000 }, async context => {
	const backend = createNodeWebAudioEngineFactory(context);
	const { controller, store } = await controllerSession(context, { engine: backend.createEngine(), engineFactory: backend.createEngine });
	try {
		const input = selectionWav('browser-mono-tone.wav', FRAMES, 1, 48_000, 440);
		await controller.actions.project.importFiles([input.file]);
		const imported = clipboardProject(controller.project), clip = imported.clips[0], source = imported.sources[0];
		assert.ok(clip?.kind === 'audio' && source?.kind === 'audio');
		assert.deepEqual([source.frameCount, source.channelCount, source.sampleRate], [FRAMES, 1, 48_000]);
		assert.deepEqual([clip.fadeInFrames, clip.fadeOutFrames, clip.fadeInShape, clip.fadeOutShape], [96, 96, 1, 1]);
		assertPcmChannelsEqual(await readCustodyPcm(store, source), input.pcm, 'actual imported RIFF16 samples');
		const before = await renderCurrent(controller, store, backend);
		for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < FRAMES; frame++) {
			const fadeIn = frame < 96 ? Math.sin(frame / 96 * Math.PI / 2) : 1;
			const fadeOut = frame > FRAMES - 96 ? Math.sin((FRAMES - frame) / 96 * Math.PI / 2) : 1;
			const expected = input.pcm[0]![frame]! * Math.SQRT1_2 * fadeIn * fadeOut;
			// Web Audio's sampled value curves interpolate the analytic edge shape.
			const tolerance = frame < 96 || frame > FRAMES - 96 ? .0003 : 1e-7;
			assert.ok(Math.abs(before[channel]![frame]! - expected) < tolerance,
				`independent fade/panner at channel ${channel}, frame ${frame}`);
		}
		controller.actions.timeline.selectClip(clip.id);
		controller.actions.timeline.setSelection(0, FRAMES);
		const beforeEffect = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		const contexts = backend.snapshot().offlineContexts;
		await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });
		const inverted = clipboardProject(controller.project), invertedClip = inverted.clips[0]; assert.ok(invertedClip?.kind === 'audio');
		assert.notEqual(invertedClip.sourceId, source.id);
		assert.deepEqual([invertedClip.durationFrames, invertedClip.fadeInFrames, invertedClip.fadeOutFrames], [FRAMES, 0, 0]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		assert.ok(backend.snapshot().offlineContexts > contexts, 'selection processing must use the shipping render graph');
		const after = await renderCurrent(controller, store, backend); assertScaled(after, before, -1);
		controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(beforeEffect));
		controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(inverted));
		const track = inverted.tracks.find(value => Array.isArray(value.clipIds) && value.clipIds.includes(invertedClip.id)); assert.ok(track);
		const effect = controller.actions.effects.add({ scope: 'track', trackId: track.id, type: 'eq', options: { params: { outputGain: -6 } } }); assert.ok(effect);
		const processed = await renderCurrent(controller, store, backend); assertScaled(processed, after, 10 ** (-6 / 20));
		const worklets = backend.snapshot().worklets;
		assert.ok(worklets.some(value => value.module && value.messages.some(message => message.type === 'status' && message.status === 'ready')),
			'the actual shipping worker must initialize its pinned WebAssembly module');
		assert.ok(worklets.every(value => value.processorErrors.length === 0));
		await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(inverted.id), controller.project);
	} finally { await controller.dispose(); await backend.dispose(); }
});

test('an offline setup failure releases its real worker and the Node child exits normally', { timeout: 20_000 }, async context => {
	if (process.env.SCAPE_NODE_AUDIO_FAILURE_CHILD !== '1') {
		const childEnv: NodeJS.ProcessEnv = { ...process.env, SCAPE_NODE_AUDIO_FAILURE_CHILD: '1' };
		delete childEnv.NODE_TEST_CONTEXT;
		const child = spawn(process.execPath, ['--max-old-space-size=2048', '--import', 'tsx', '--import', './scripts/node-style-asset-loader.mjs',
			'--test', '--test-name-pattern=an offline setup failure', fileURLToPath(import.meta.url)], {
			cwd: fileURLToPath(new URL('..', import.meta.url)), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		const capture = (chunk: Buffer) => { if (output.length < 128_000) output += chunk.toString(); };
		child.stdout.on('data', capture); child.stderr.on('data', capture);
		const deadline = setTimeout(() => { child.kill('SIGKILL'); }, 12_000);
		try {
			const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
				child.once('error', reject); child.once('close', (code, signal) => { resolve({ code, signal }); });
			});
			assert.equal(result.signal, null, output); assert.equal(result.code, 0, output);
			assert.match(output, /real offline worker released after setup failure/u);
		} finally { clearTimeout(deadline); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
		return;
	}
	const backend = createNodeWebAudioEngineFactory(context);
	const { controller, store } = await controllerSession(context, { engine: backend.createEngine(), engineFactory: backend.createEngine });
	const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode'); assert.ok(original);
	const RealWorklet = globalThis.AudioWorkletNode;
	try {
		const input = selectionWav('browser-mono-tone.wav', FRAMES, 1, 48_000, 440);
		await controller.actions.project.importFiles([input.file]);
		const project = clipboardProject(controller.project), track = project.tracks.find(value => Array.isArray(value.clipIds) && value.clipIds.length); assert.ok(track);
		controller.actions.effects.add({ scope: 'track', trackId: track.id, type: 'eq', options: { params: { outputGain: -6 } } });
		Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, writable: true, value: class extends RealWorklet {
			constructor(audioContext: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
				super(audioContext, name, options);
				throw new Error('Intentional offline setup failure after the real worklet was created.');
			}
		} });
		await assert.rejects(renderCurrent(controller, store, backend), /Intentional offline setup failure/u);
		assert.ok(backend.snapshot().worklets.some(value => value.module), 'the failed scope must own a real WASM worklet');
	} finally {
		Object.defineProperty(globalThis, 'AudioWorkletNode', original);
		await controller.dispose(); await backend.dispose();
	}
	console.log('real offline worker released after setup failure');
});
