/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { COPY, createAudioEditorController, createProjectStore } from './audio-editor-controller-harness.js';
import { midiPreviewEngine } from './midi-preview-context.ts';
import type { EnginePublicApi, EngineChunkSourceInput, EngineSourceBufferInput } from '../../src/common/editor/engine/public-api.ts';
import type { MidiNote } from '../../src/common/editor/midi-model.ts';
import { MockAudioBuffer } from './audio-editor-controller-fixtures.js';
import { deferred } from './async-test-control.ts';

/** Real synthesis, storage, commands and DSP; render this neutral fixture's canonical PCM. */
export async function midiEffectsFixture(t: TestContext, blockSourceRegistration = false) {
	const memory = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const entered = deferred<void>(), release = deferred<void>();
	const sourceReadEntered = deferred<void>(), releaseSourceRead = deferred<void>();
	let hold = false, captureSource = false, pendingSourceId: string | null = null;
	const store = new Proxy(memory, { get(target, key) {
		if (key === 'getSourceMetadata') return async (...args: Parameters<typeof memory.getSourceMetadata>) => {
			if (blockSourceRegistration && args[0] === pendingSourceId) { sourceReadEntered.resolve(); await releaseSourceRead.promise; }
			return target.getSourceMetadata(...args);
		};
		if (key === 'beginSourceWrite') return async (...args: Parameters<typeof memory.beginSourceWrite>) => {
			if (captureSource) { pendingSourceId = args[0]; captureSource = false; }
			const writer = await target.beginSourceWrite(...args);
			return { ...writer, async write(channels: Float32Array[]) {
				if (hold) { entered.resolve(); await release.promise; }
				return writer.write(channels);
			} };
		};
		const value = Reflect.get(target, key, target);
		return typeof value === 'function' ? value.bind(target) : value;
	} });
	const bufferContext = { createBuffer: (...args: ConstructorParameters<typeof MockAudioBuffer>) => new MockAudioBuffer(...args) };
	const inputs: Float32Array[] = [];
	const readyInputs: boolean[] = [], renderedSourceIds: string[] = [];
	const engineFactory = (): EnginePublicApi => {
		const engine = midiPreviewEngine();
		let project: Parameters<EnginePublicApi['loadProject']>[0] = null;
		let providers: EngineChunkSourceInput | undefined, buffers: EngineSourceBufferInput | undefined;
		const setChunkSources = engine.setChunkSources.bind(engine);
		engine.setChunkSources = value => { providers = value; return setChunkSources(value); };
		engine.loadProject = (next, sourceBuffers) => { project = next; buffers = sourceBuffers; return engine; };
		engine.renderMix = async (options = {}) => {
			assert.ok(project);
			const track = project.tracks?.find(track => track.type === 'audio'); assert.ok(track);
			if (!Array.isArray(track.clipIds) || typeof track.clipIds[0] !== 'string') throw new Error('The fixture requires its selected strip clip.');
			const selectedId: string = track.clipIds[0];
			const clip = project.clips?.find(clip => clip.id === selectedId); assert.ok(clip);
			if (typeof clip.sourceId !== 'string') throw new Error('The fixture requires its canonical audio source.');
			renderedSourceIds.push(clip.sourceId);
			const ready = Boolean(providers instanceof Map && providers.has(clip.sourceId)
				|| buffers instanceof Map && buffers.has(clip.sourceId));
			readyInputs.push(ready);
			if (blockSourceRegistration && !ready) {
				const samples = new Float32Array((options.endFrame ?? 384_000) - (options.startFrame ?? 0));
				inputs.push(samples);
				return { sampleRate: project.sampleRate, channels: [samples] };
			}
			const buffer = await memory.loadSourceAudioBuffer(clip.sourceId, bufferContext);
			const start = options.startFrame ?? 0, count = (options.endFrame ?? buffer.length) - start;
			const samples = buffer.getChannelData(0).slice(start, start + count);
			// The worker owns its input, so keep an independent observation for the signed-PCM assertion.
			inputs.push(samples.slice());
			return { sampleRate: project.sampleRate, channels: [samples] };
		};
		return engine;
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store, engine: midiPreviewEngine(), engineFactory });
	t.after(async () => { release.resolve(); releaseSourceRead.resolve(); await controller.dispose(); });
	await controller.ready;
	const { clipId } = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(clipId, { id: 'note', pitch: 60, velocity: 100,
		startFrame: 0, durationFrames: 4000, channel: 0 });
	controller.actions.timeline.selectClip(clipId);
	return {
		controller, clipId, inputs, readyInputs, renderedSourceIds, release, sourceReadEntered, releaseSourceRead,
		async midiSamples() {
			assert.ok(pendingSourceId);
			return (await memory.loadSourceAudioBuffer(pendingSourceId, bufferContext)).getChannelData(0);
		},
		async pendingNote(changes: Partial<MidiNote> = { pitch: 67 }) {
			hold = true; captureSource = true;
			const updating = controller.actions.midi.updateNote(clipId, 'note', changes);
			void updating.catch(() => {});
			await entered.promise;
			return { updating };
		},
		async samples() {
			const clip = controller.project?.clips.find(clip => clip.id === clipId); assert.ok(clip);
			return (await memory.loadSourceAudioBuffer(clip.sourceId, bufferContext)).getChannelData(0);
		},
	};
}
