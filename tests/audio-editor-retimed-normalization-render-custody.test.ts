/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { auditStaffPadWasm } from '../scripts/audit-staffpad-wasm.mjs';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { StaffPadRenderClient } from '../src/common/editor/staffpad/client.js';
import { loadStaffPadWasm, renderStaffPad } from '../src/common/editor/staffpad/runtime.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { exportDialogMetadataFields } from '../src/common/editor/ui/export-dialog-metadata-fields.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { createNodeShippingWorkers } from './helpers/node-shipping-worker.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { readWavePcm } from './helpers/read-wave-pcm.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

const workerEntry = new URL('../src/common/editor/staffpad/worker.js', import.meta.url);
const wasm = readFileSync(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url));
const wasmSha256 = '6b7e3fa86ddd90ddd6c358cf431742bd890fb76354509aa5732e4d3686791b7b';

test('StaffPad worker failures and owner setup failure release actual worker threads', { timeout: 5000 }, async context => {
	const workers = createNodeShippingWorkers(context), directory = await mkdtemp(join(tmpdir(), 'soundscaper-staffpad-worker-'));
	try {
		for (const [name, source, expected] of [
			['import-failure', "throw new Error('Actual worker module failure');", /Actual worker module failure/u],
			['natural-exit', 'export const complete = true;', /exited unexpectedly \(code 0\)/u],
		] as const) {
			const file = join(directory, `${name}.mjs`); await writeFile(file, source);
			const client = new StaffPadRenderClient({ workerFactory: () => workers.createWorker(pathToFileURL(file)) });
			try {
				await assert.rejects(client.render({ channels: [new Float32Array(12_000)], sampleRate: 48_000,
					transform: { pitchRatio: 2 } }, { signal: context.signal }), expected);
			} finally { client.dispose(); }
		}
		let observedStart: (() => void) | undefined;
		const started = new Promise<void>(resolve => { observedStart = resolve; });
		const client = new StaffPadRenderClient({ workerFactory: () => workers.createWorker(workerEntry),
			wasmUrl: `data:application/wasm;base64,${wasm.toString('base64')}` });
		const request = client.render({ channels: [Float32Array.from({ length: 96_000 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / 48_000))],
			sampleRate: 48_000, transform: { pitchRatio: 2 }, chunkFrames: 1024 },
		{ signal: context.signal, onProgress() { observedStart?.(); } });
		const settled = request.then(() => ({ completed: true, error: null }), (error: unknown) => ({ completed: false, error }));
		try {
			await started;
			assert.ok(workers.snapshot().some(worker => worker.exitCode === null), 'the shipping worker is alive when its owner fails');
			throw new Error('Owner setup failed after actual StaffPad progress');
		} catch (error) {
			assert.ok(error instanceof Error && error.message === 'Owner setup failed after actual StaffPad progress');
		} finally { client.dispose(); }
		const result = await settled;
		assert.equal(result.completed, false); assert.ok(result.error instanceof Error);
		const firstDisposal = workers.dispose(); assert.equal(workers.dispose(), firstDisposal); await firstDisposal;
		assert.equal(workers.snapshot().length, 3); assert.ok(workers.snapshot().every(worker => worker.exitCode !== null));
	} finally { await workers.dispose(); await rm(directory, { recursive: true, force: true }); }
});

/** Exact RIFF16 transient authored by the original cold/warm browser cases. */
function transientRecording() {
	const frames = 96_000, bytes = Buffer.alloc(44 + frames * 2), pcm = new Float32Array(frames);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(96_000, 28); bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
	for (let frame = 0; frame < 100; frame++) {
		const value = Math.round(Math.sin(frame * Math.PI / 100) * 16_000);
		bytes.writeInt16LE(value, 44 + (24_000 + frame) * 2); pcm[24_000 + frame] = value / 32_768;
	}
	assert.equal(createHash('sha256').update(bytes).digest('hex'), '092ffdfdd7836b5fdec97be58bb903cc38300fcd88b6ae31beef056adb267697');
	return { file: new File([bytes], 'transient.wav', { type: 'audio/wav' }), pcm: [pcm] };
}

async function musicalRecording(bpm: number) {
	const pcm = [Float32Array.from({ length: 192_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 100 * frame / 48_000))];
	const tempoMap = { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] };
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 192_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 192_000,
		anchor: 'musical', musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 8,
		pitchCents: 0, speedRatio: 1, linkPitchAndTempo: false }, { projectSampleRate: 48_000, tempoMap });
	const project = createSoundscaperProject({ id: `musical-normalize-${bpm}`, tempoMap, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	// The original browser constructs this physical input archive in an isolated
	// production memory store; the controller and recipient use product stores.
	const sender = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `musical-input-${bpm}` });
	try {
		const writer = await sender.beginSourceWrite(source.storageKey, source);
		for (let frame = 0; frame < 192_000; frame += 65_536) await writer.write([pcm[0]!.subarray(frame, frame + 65_536)]);
		await writer.commit();
		const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, sender);
		assert.ok(archive.blob);
		return { file: new File([archive.blob], 'Musical.sscape'), pcm };
	} finally { await sender.close(); }
}

function peak(channels: readonly Float32Array[]) {
	let result = 0; for (const channel of channels) for (const sample of channel) result = Math.max(result, Math.abs(sample));
	return result;
}

function musicalFrequency(samples: Float32Array) {
	const start = Math.floor(samples.length / 4), end = Math.floor(samples.length * 3 / 4);
	let crossings = 0;
	for (let frame = start + 1; frame < end; frame++) if (samples[frame - 1]! <= 0 && samples[frame]! > 0) crossings++;
	return crossings * 48_000 / (end - start);
}

const profiles = [{ bpm: 240 }, { bpm: 60 }, { warmed: false }, { warmed: true }] as const;
for (const profile of profiles) test(`StaffPad normalization custody: ${'bpm' in profile ? `musical ${profile.bpm} BPM` : `independent Pitch12 warmed ${profile.warmed}`}`,
	{ timeout: 30_000 }, async context => {
		assert.equal(createHash('sha256').update(wasm).digest('hex'), wasmSha256);
		const audit = await auditStaffPadWasm(); assert.equal(audit.ok, true, audit.findings.join('\n'));
		const workers = createNodeShippingWorkers(context), native = createNodeWebAudioEngineFactory(context);
		const renderParameters: unknown[] = [];
		const workerChunks: { offset: number; channels: Float32Array[] }[] = [];
		const client = new StaffPadRenderClient({ workerFactory: () => {
			const port = workers.createWorker(workerEntry), post = port.postMessage;
			port.addEventListener('message', event => {
				const data = event.data;
				if (!data || typeof data !== 'object' || Reflect.get(data, 'type') !== 'chunk') return;
				const offset: unknown = Reflect.get(data, 'frameOffset'), channels: unknown = Reflect.get(data, 'channels');
				assert.ok(typeof offset === 'number' && Number.isSafeInteger(offset) && Array.isArray(channels));
				workerChunks.push({ offset, channels: channels.map((channel: unknown) => {
					assert.ok(channel instanceof Float32Array); return channel.slice();
				}) });
			});
			port.postMessage = (message, transfer) => {
				if (message && typeof message === 'object' && Reflect.get(message, 'type') === 'render') {
					const request: unknown = Reflect.get(message, 'request'); assert.ok(request && typeof request === 'object');
					renderParameters.push(structuredClone(Reflect.get(request, 'transform')));
				}
				post(message, transfer);
			};
			return port;
		},
			wasmUrl: `data:application/wasm;base64,${wasm.toString('base64')}` });
		const previews: Float32Array[][] = [];
		let measuring = false;
		const createEngine: typeof native.createEngine = options => {
			const engine = native.createEngine(options), render = engine.renderMix.bind(engine);
			engine.renderMix = async options => {
				const output = await render(options);
				if (measuring) {
					assert.ok(output instanceof AudioBuffer); assert.equal(output.sampleRate, 48_000);
					previews.push(Array.from({ length: output.numberOfChannels }, (_, channel) => {
						const samples = new Float32Array(output.length); output.copyFromChannel(samples, channel); return samples;
					}));
				}
				return output;
			};
			return engine;
		};
		const engine = createEngine();
		const { controller, store } = await controllerSession(context, { engine, engineFactory: createEngine,
			staffPadRenderClient: client, scapeProjectRuntime: createSoundscaperScapeNativeRuntime() });
		try {
			const recording = 'bpm' in profile ? await musicalRecording(profile.bpm) : transientRecording();
			if ('bpm' in profile) {
				await controller.actions.project.openScapeFile(recording.file, () => 'copy');
				controller.actions.project.setTempo(profile.bpm);
			} else await controller.actions.project.importFiles([recording.file]);
			const imported = clipboardProject(controller.project), clip = imported.clips[0], source = imported.sources[0];
			assert.ok(clip?.kind === 'audio' && source?.kind === 'audio');
			assert.deepEqual([imported.sources.length, imported.clips.length, source.sampleRate, source.channelCount, source.frameCount],
				[1, 1, 48_000, 1, 'bpm' in profile ? 192_000 : 96_000]);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), recording.pcm, 'every original sample before retimed normalization');
			if (!('bpm' in profile)) {
				controller.actions.clip.update(clip.id, { gain: .1, pitchCents: 1200 });
				const owner = imported.tracks.find(track => track.type === 'audio' && track.clipIds.includes(clip.id));
				assert.ok(owner?.type === 'audio');
				controller.actions.track.update(owner.id, { pan: -1 });
				const configured = clipboardProject(controller.project), configuredClip = configured.clips.find(value => value.id === clip.id);
				assert.ok(configuredClip?.kind === 'audio');
				assert.deepEqual([configuredClip.pitchCents, configuredClip.gain, configured.tracks.find(value => value.id === owner.id)?.pan],
					[1200, .1, -1], 'the exact visible Pitch12, minus20dB and owning hard-left pan setup must commit');
			}
			const frames = 'bpm' in profile ? profile.bpm === 240 ? 96_000 : 384_000 : 96_000;
			const render = async () => {
				// The public exporter owns source/cache preparation and its detached
				// renderer. The live headless engine may retain a lazy source mapping.
				const project = clipboardProject(controller.project), initial = createExportDialogInitialSettings(project);
				const request = createExportDialogRequest(initial, { project, desktop: false,
					channelMapping: initial.channelMapping, metadata: exportDialogMetadataFields(initial, {}) });
				assert.deepEqual([request.format, request.sampleFormat, request.dither, request.includeTail, request.channelMapping],
					['wav', 'int24', 'triangular', true, 'preserve']);
				const output: unknown = await controller.actions.export.start(request);
				assert.ok(output && typeof output === 'object' && 'url' in output && typeof output.url === 'string');
				const response = await fetch(output.url); assert.equal(response.ok, true);
				const decoded = readWavePcm(new Uint8Array(await response.arrayBuffer()));
				assert.equal(decoded.sampleRate, 48_000); assert.deepEqual(decoded.channels.map(channel => channel.length), [frames, frames]);
				return decoded.channels;
			};
			let baselineLufs: number | null = null;
			if ('bpm' in profile) {
				const baseline = await render();
				const measured = measureBextLoudness([Float32Array.from(baseline[0]!, sample => sample * Math.SQRT2)], 48_000).loudnessValue;
				assert.ok(typeof measured === 'number'); baselineLufs = measured;
			} else if (profile.warmed) await render();
			const warmedRenders = workers.snapshot().reduce((count, worker) => count + worker.completedRenders, 0);
			if ('bpm' in profile || profile.warmed) assert.equal(warmedRenders, 1, 'the actual first WAV export commits the retimed cache');
			else assert.equal(warmedRenders, 0, 'the cold case reaches normalization before any StaffPad result is committed');
			const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
			measuring = true;
			try {
				if ('bpm' in profile) await assert.doesNotReject(controller.actions.clip.normalizeLoudness(clip.id));
				else await assert.doesNotReject(controller.actions.clip.normalizePeak(clip.id));
			} finally { measuring = false; }
			assert.equal(previews.length, 1); assert.deepEqual(previews[0]!.map(channel => channel.length), [frames]);
			assert.ok(previews[0]!.every(channel => channel.every(Number.isFinite)));
			assert.equal(workers.snapshot().reduce((count, worker) => count + worker.completedRenders, 0), 1,
				'normalization requires the real committed StaffPad cache and reuses an already warmed one');
			assert.equal(renderParameters.length, 1);
			const transform = renderParameters[0]; assert.ok(transform && typeof transform === 'object');
			const expectedTempo = 'bpm' in profile ? profile.bpm / 120 : 1, expectedPitch = 'bpm' in profile ? 1 : 2;
			assert.deepEqual(Reflect.get(transform, 'keyframes'), [
				{ position: 0, tempoRatio: expectedTempo, pitchRatio: expectedPitch },
				{ position: 1, tempoRatio: expectedTempo, pitchRatio: expectedPitch },
			], 'the real worker must receive the independent literal tempo and Pitch12 transform');
			assert.equal(Reflect.get(transform, 'preserveFormants'), false);
			// This separately instantiated pinned DSP receives the original fixture
			// PCM and literal transform, never a cache plan or worker-derived answer.
			// It qualifies every transported prepared sample, including Pitch12.
			const reference = new Float32Array(frames), prepared = new Float32Array(frames);
			await renderStaffPad({ channels: recording.pcm, sampleRate: 48_000, outputFrames: frames, chunkFrames: 1024,
				transform: { tempoRatio: expectedTempo, pitchRatio: expectedPitch, preserveFormants: false } }, await loadStaffPadWasm(wasm), {
				onChunk(channels: Float32Array[], frameOffset: number) { assert.equal(channels.length, 1); reference.set(channels[0]!, frameOffset); },
			});
			let preparedFrames = 0;
			for (const chunk of workerChunks) {
				assert.equal(chunk.offset, preparedFrames); assert.equal(chunk.channels.length, 1);
				prepared.set(chunk.channels[0]!, chunk.offset); preparedFrames += chunk.channels[0]!.length;
			}
			assert.equal(preparedFrames, frames);
			assertPcmChannelsEqual([prepared], [reference], 'every prepared worker sample matches the literal independently requested pinned transform');
			const changed = clipboardProject(controller.project), normalized = changed.clips.find(value => value.id === clip.id);
			assert.ok(normalized?.kind === 'audio' && normalized.gain > 1);
			const preview = previews[0]!;
			if ('bpm' in profile) {
				assert.ok(Math.abs(musicalFrequency(preview[0]!) - 100) < 1, 'musical retiming preserves the independent authored 100Hz pitch');
				assert.ok(typeof baselineLufs === 'number');
				assert.ok(Math.abs(20 * Math.log10(normalized.gain) - (-14 - baselineLufs)) < .2);
				const lufs = measureBextLoudness(preview.map(channel => Float32Array.from(channel, sample => sample * normalized.gain)), 48_000).loudnessValue;
				assert.ok(typeof lufs === 'number' && Math.abs(lufs + 14) < .2);
			} else assert.ok(Math.abs(20 * Math.log10(peak(preview) * normalized.gain) + 1) < .01);
			const output = await render();
			if ('bpm' in profile) {
				const lufs = measureBextLoudness([Float32Array.from(output[0]!, sample => sample * Math.SQRT2)], 48_000).loudnessValue;
				assert.ok(typeof lufs === 'number' && Math.abs(lufs + 14) < .2);
			} else assert.ok(Math.abs(20 * Math.log10(peak(output)) + 1) < .1,
				`Actual output ${20 * Math.log10(peak(output))} dBFS, gain ${normalized.gain}, preview peak ${peak(preview)}`);
			assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
			assert.deepEqual(clipboardDocument(changed), clipboardDocument({ ...before,
				clips: before.clips.map(value => value.id === clip.id ? { ...value, gain: normalized.gain } : value) }));
			controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
			controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(changed));
			await controller.actions.project.flush();
			assert.deepEqual(await store.loadProject(changed.id), controller.project);
			assertPcmChannelsEqual(await readCustodyPcm(store, source), recording.pcm, 'every original sample after history and store publication');
			const messages = workers.snapshot(); assert.equal(messages.length, 1);
			assert.ok(messages[0]!.renderRequests === 1 && messages[0]!.completedRenders === 1 && messages[0]!.chunks > 0,
				'normalization and the final WAV export reuse one exact committed worker result');
			assert.ok(native.snapshot().offlineContexts > 0);
		} finally {
			try { await controller.dispose(); } finally { client.dispose(); await native.dispose(); await workers.dispose(); }
			assert.ok(workers.snapshot().every(worker => worker.exitCode !== null));
		}
	});
