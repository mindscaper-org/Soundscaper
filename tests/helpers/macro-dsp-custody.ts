/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { buildMacroSandboxModule } from '../../src/common/editor/macro-script/sandbox-client.ts';
import { macroPreludeImportSource } from '../../src/common/editor/macro-script/browser-prelude-loader.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { projectForRuntimeConsumers } from '../../src/common/editor/project-current-runtime.ts';
import { controllerSession } from './soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './node-web-audio-engine.ts';
import { registerMockModuleUrls } from './mock-module-urls.ts';
import { clipboardDocument, clipboardProject } from './clipboard-source-custody.ts';
import { readCustodyPcm } from './audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';
import { createMacroThreadOwner } from './macro-thread-worker-transport.ts';

export const MACRO_RATE = 48_000;
type Session = Awaited<ReturnType<typeof controllerSession>>;

/** The original RIFF16 constructor, with independently retained authored/quantized samples. */
export function macroRecording(name: string, frequency: number, frames = 38_400, channels = 2, amplitude = .35) {
	const bytes = Buffer.alloc(44 + frames * channels * 2);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
	bytes.writeUInt32LE(MACRO_RATE, 24); bytes.writeUInt32LE(MACRO_RATE * channels * 2, 28);
	bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36); bytes.writeUInt32LE(frames * channels * 2, 40);
	const pcm = Array.from({ length: channels }, () => new Float32Array(frames));
	for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
		const value = Math.round(Math.sin(2 * Math.PI * frequency * frame / MACRO_RATE + (channel ? Math.PI / 3 : 0)) * amplitude * 32_767);
		bytes.writeInt16LE(value, 44 + (frame * channels + channel) * 2); pcm[channel]![frame] = (value || 0) / 32_768;
	}
	return { bytes, pcm, file: new File([bytes], name, { type: 'audio/wav' }) };
}

export function independentlyFaded(channels: readonly Float32Array[]): Float32Array[] {
	return channels.map(channel => Float32Array.from(channel, (sample, frame) => sample
		* (frame < 96 ? Math.sin(frame / 96 * Math.PI / 2) : 1)
		* (frame > channel.length - 96 ? Math.sin((channel.length - frame) / 96 * Math.PI / 2) : 1)));
}

export function assertMacroPcm(actual: readonly Float32Array[], expected: readonly Float32Array[], label: string, edgeAmplitude = 0) {
	assert.equal(actual.length, expected.length, `${label} channels`);
	for (let channel = 0; channel < expected.length; channel++) {
		assert.equal(actual[channel]!.length, expected[channel]!.length, `${label} frames`);
		for (let frame = 0; frame < expected[channel]!.length; frame++) {
			// Shipping gain curves specify .001 approximation error; scale by authored amplitude.
			const edge = frame < 96 || frame > expected[channel]!.length - 96;
			const tolerance = edge ? edgeAmplitude * .0011 + 1e-6 : 1e-6;
			if (!(Math.abs(actual[channel]![frame]! - expected[channel]![frame]!) < tolerance))
				assert.fail(`${label} channel${channel}/frame${frame}: ${actual[channel]![frame]} versus ${expected[channel]![frame]}`);
		}
	}
}

/** Actual product controller/store and shipping native graph; substitute only the Worker platform. */
export async function macroDspCustody(context: TestContext) {
	const resources: {
		session?: Session;
		native?: ReturnType<typeof createNodeWebAudioEngineFactory>;
		hooks?: ReturnType<typeof registerMockModuleUrls>;
		threads?: ReturnType<typeof createMacroThreadOwner>;
	} = {};
	let disposal: Promise<void> | undefined;
	const dispose = (): Promise<void> => disposal ??= (async () => {
		try { await resources.session?.controller.dispose(); }
		finally { try { await resources.threads?.dispose(); } finally { try { await resources.native?.dispose(); } finally { resources.hooks?.deregister(); } } }
	})();
	context.after(dispose);
	const workers = createMacroThreadOwner(); resources.threads = workers;
	resources.hooks = registerMockModuleUrls({ '../../macro-script/browser-sandbox.ts': new URL('./macro-thread-worker-transport.ts', import.meta.url).href });
	const factory = createNodeWebAudioEngineFactory(context); resources.native = factory;
	const engine = factory.createEngine();
	const archive = createSoundscaperScapeNativeRuntime();
	const session = await controllerSession(context, { engine, engineFactory: factory.createEngine, scapeProjectRuntime: archive });
	resources.session = session;
	const { controller, store } = session;
	const cancel = () => { controller.actions.macros.cancel(); };
	context.signal.addEventListener('abort', cancel, { once: true });
	context.after(() => { context.signal.removeEventListener('abort', cancel); });
	assert.equal(typeof globalThis.Worker, 'undefined', 'retain the real shipping offline-effect fallback');
	return { controller, store, factory, threads: workers, dispose,
		async open(project: SoundscaperProject, inputs: ReadonlyMap<string, readonly Float32Array[]>) {
			const donor = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
			try {
				for (const source of project.sources) {
					assert.ok(source.kind === 'audio'); const pcm = inputs.get(source.id); assert.ok(pcm);
					const writer = await donor.beginSourceWrite(source.storageKey, source);
					for (let frame = 0; frame < source.frameCount; frame += source.chunkFrames)
						await writer.write(pcm.map(channel => channel.subarray(frame, frame + source.chunkFrames)));
					await writer.commit();
				}
				const exported = await archive.exportScapeProject(project, donor); assert.ok(exported.blob);
				await controller.actions.project.openScapeFile(new File([exported.blob], 'Recording.sscape', { type: 'application/zip' }), () => 'copy');
				assert.equal(controller.getSnapshot().readOnly, false);
				assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(project));
			} finally { await donor.close(); }
		},
		async render(frames: number): Promise<Float32Array[]> {
			const project = clipboardProject(controller.project), renderer = factory.createEngine();
			try {
				const buffers = new Map<string, AudioBuffer>();
				for (const source of project.sources) {
					assert.ok(source.kind === 'audio');
					const buffer = await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
					assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
				}
				renderer.loadProject(projectForRuntimeConsumers(project), buffers);
				const output = await renderer.renderMix({ startFrame: 0, endFrame: frames }); assert.ok(output instanceof AudioBuffer);
				assert.deepEqual([output.numberOfChannels, output.sampleRate, output.length], [2, MACRO_RATE, frames]);
				return Array.from({ length: 2 }, (_, channel) => {
					const pcm = new Float32Array(frames); output.copyFromChannel(pcm, channel); return pcm;
				});
			} finally { await renderer.dispose(); }
		},
		async history(baseline: SoundscaperProject, changed: SoundscaperProject, original: readonly Float32Array[], expected: readonly Float32Array[]) {
			controller.actions.edit.undo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
			assertMacroPcm(await this.render(original[0]!.length), original, 'actual macro Undo output');
			controller.actions.edit.redo();
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(changed));
			assertMacroPcm(await this.render(expected[0]!.length), expected, 'actual macro Redo output');
			await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(changed.id), controller.project);
		},
		async source(source: SoundscaperProject['sources'][number], expected: readonly Float32Array[]) {
			assert.ok(source.kind === 'audio');
			assertPcmChannelsEqual(await readCustodyPcm(store, source), expected, `immutable original ${source.id}`);
		},
		async assertPrograms(programs: readonly string[], expectedMethods: readonly (readonly string[])[]) {
			await workers.dispose(); const records = workers.snapshot(); assert.equal(records.length, programs.length);
			for (const [index, source] of programs.entries()) {
				const module = buildMacroSandboxModule(macroPreludeImportSource(new URL('../../src/common/editor/macro-script/sandbox-prelude.js', import.meta.url).href, import.meta.url), source);
				const record = records[index]!;
				assert.equal(record.sourceSha256, createHash('sha256').update(module).digest('hex'), 'exact attested authored module');
				assert.notEqual(record.exitCode, null, 'actual thread exit joined');
				assert.ok(record.terminationRequested);
				const calls = record.events.filter(event => event.direction === 'worker-to-host' && event.data && typeof event.data === 'object' && Reflect.get(event.data, 'type') === 'call');
				assert.deepEqual(calls.map(event => Reflect.get(event.data as object, 'method')), expectedMethods[index]);
				assert.equal(record.events.filter(event => event.direction === 'worker-to-host' && event.data && typeof event.data === 'object' && Reflect.get(event.data, 'type') === 'done').length, 1);
			}
			assert.ok(factory.snapshot().worklets.every(worklet => worklet.processorErrors.length === 0));
		},
	};
}
