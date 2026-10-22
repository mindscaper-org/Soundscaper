/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { installNyquistArchivePlugin, parseNyquistArchiveManifest } from '../src/common/editor/nyquist/archive-catalog.js';
import { createNyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createFixture, createCurrentAudioEditorProject, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { conformNyquistTargetChannels, nyquistAudioResultBytes } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';

test('published Vocal Reduction to mono applies its result to both channels of the stereo selection', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const left = Float32Array.from({ length: 4_800 }, (_, i) => .2 * Math.sin(i * Math.PI * 880 / 48_000));
	const right = Float32Array.from({ length: left.length }, (_, i) => .05 * Math.cos(i * Math.PI * 1_760 / 48_000));
	const { store, project } = await createFixture('nyquist-mono-result', { sampleRate: 48_000,
		tracks: [{ id: 'voice', name: 'Voice', input: left }] });
	const writer = await store.beginSourceWrite('stereo', { name: 'Stereo.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 2 });
	await writer.write([left, right]); await writer.commit({ sampleRate: 48_000, channelCount: 2 });
	await store.saveProject(createCurrentAudioEditorProject({ id: project.id, sampleRate: 48_000, tracks: project.tracks,
		sources: [{ ...project.sources[0], id: 'stereo', storageKey: 'stereo', channelCount: 2 }],
		clips: project.clips.map(clip => ({ ...clip, sourceId: 'stereo' })) }));
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const options = { headless: true, locale: 'en', copy: ENGLISH_COPY, store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		nyquistEvaluator: (request: Parameters<typeof runtime.evaluate>[0]) => Promise.resolve(runtime.evaluate(request)),
		renderSnapshot: async () => ({ length: left.length, sampleRate: 48_000, numberOfChannels: 2,
			getChannelData: (channel: number) => channel === 0 ? left : right }),
	};
	const controller = createAudioEditorController(null, options);
	context.after(async () => { await controller.dispose(); });
	await controller.ready; controller.actions.timeline.selectTrack('voice');
	controller.actions.timeline.setSelection(0, left.length, { trackIds: ['voice'], clipIds: [] });
	const fixture = new URL('./fixtures/nyquist-archive/', import.meta.url);
	const manifest = await parseNyquistArchiveManifest(gunzipSync(readFileSync(new URL('manifest.json.gz', fixture))));
	const artifact = manifest.artifacts.find((entry: { fileName: string }) => entry.fileName === 'vocalrediso.ny'); assert.ok(artifact);
	const archive = createNyquistArchiveStore({ getItem: () => null, setItem() {} });
	const plugin = await installNyquistArchivePlugin(archive, artifact, {
		fetchImpl: async () => new Response(gunzipSync(readFileSync(new URL('vocalrediso.ny.gz', fixture)))),
	});
	await controller.actions.nyquist.evaluate({ source: archive.source(plugin.id), role: 'process', name: plugin.name,
		controls: Object.fromEntries(plugin.controls.filter((control: { variable?: string }) => control.variable)
			.map((control: { variable: string; defaultValue: unknown }) => [control.variable, control.defaultValue])) });
	const sourceId = controller.project?.clips[0]?.sourceId; assert.ok(sourceId);
	const source = controller.project?.sources.find(candidate => candidate.id === sourceId);
	assert.equal(source?.channelCount, 2);
	const packets: Readonly<{ channels: readonly Float32Array[] }>[] = [];
	for await (const packet of store.readSourceChunks(sourceId)) packets.push(packet);
	assert.ok(packets.length); assert.deepEqual(packets[0]?.channels[0], packets[0]?.channels[1]);
	assert.ok(packets[0]?.channels[0]?.some(value => Math.abs(value) > .01));
	controller.actions.edit.undo(); assert.equal(controller.project?.clips[0]?.sourceId, 'stereo');
	controller.actions.edit.redo(); assert.equal(controller.project?.clips[0]?.sourceId, sourceId);
});

test('Nyquist mono duplication charges the delivered stereo extent without copying PCM', () => {
	const mono = { type: 'audio', channels: [new Float32Array(4)], channelCount: 1 };
	const stereo = conformNyquistTargetChannels(mono, 2);
	assert.equal(stereo?.channels?.length, 2);
	assert.equal(stereo?.channels?.[0], mono.channels[0]); assert.equal(stereo?.channels?.[1], mono.channels[0]);
	assert.equal(nyquistAudioResultBytes(stereo), 32); assert.equal(mono.channels.length, 1);
	assert.equal(conformNyquistTargetChannels(mono, 1), mono);
	assert.equal(conformNyquistTargetChannels(mono, 4), mono);
	assert.equal(conformNyquistTargetChannels(stereo, 1), stereo, 'a surplus channel layout remains subject to persistence admission');
});
