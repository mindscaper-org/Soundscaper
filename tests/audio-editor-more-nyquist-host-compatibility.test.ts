/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { installNyquistArchivePlugin, parseNyquistArchiveManifest } from '../src/common/editor/nyquist/archive-catalog.js';
import { createNyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createController, createCurrentAudioEditorProject, createFixture } from './helpers/audio-editor-nyquist-controller-harness.js';

test('the published Trim Silence runs on selected PCM through the public Nyquist action', async () => {
	const plugin = await installPlugin('TrimSilence.ny');
	const input = Float32Array.from({ length: 8_000 }, (_, i) => i < 800 || i >= 7_200 ? 0 : 0.2 * Math.cos(i * Math.PI / 10));
	const { controller } = await controllerFor(input);
	try {
		const result = await controller.actions.nyquist.evaluate({ source: plugin.source, role: 'process',
			name: plugin.name, controls: { threshold: -48, 'min-start-silence': 0, 'min-end-silence': 0 } });
		assert.ok(result && typeof result === 'object' && 'type' in result && result.type === 'audio');
		assert.ok('frameCount' in result && typeof result.frameCount === 'number');
		assert.ok(result.frameCount >= 6_300 && result.frameCount <= 6_500, `Expected 0.8s, got ${String(result.frameCount)} frames.`);
	} finally { await controller.dispose(); }
});

test('the published ACX Check can inspect the complete owning track duration', async () => {
	const plugin = await installPlugin('ACX-Check.ny');
	const input = Float32Array.from({ length: 8_000 }, (_, i) => 0.2 * Math.cos(i * Math.PI / 10));
	const { controller } = await controllerFor(input);
	try {
		const result = await controller.actions.nyquist.evaluate({ source: plugin.source, role: 'analyze', name: plugin.name });
		assert.ok(result && typeof result === 'object' && 'type' in result && result.type === 'message');
		assert.ok('message' in result && typeof result.message === 'string');
		assert.match(result.message, /Peak level:.*RMS level:/su);
	} finally { await controller.dispose(); }
});

test('the published Pluck generator applies its requested duration beyond the preview limit', async () => {
	const plugin = await installPlugin('Pluck-hz.ny');
	const { controller } = await controllerFor(new Float32Array(8_000));
	try {
		const result = await controller.actions.nyquist.evaluate({ source: plugin.source, role: 'generate',
			name: plugin.name, controls: { freq: 261.626, fade: 0, dur: 8 } });
		assert.ok(result && typeof result === 'object' && 'frameCount' in result);
		assert.equal(result.frameCount, 64_000);
	} finally { await controller.dispose(); }
});

test('the published Oxygene Surf generator retains floating point widget bindings for whole numbers', async () => {
	const plugin = await installPlugin('surf-oxy.ny');
	const { controller } = await controllerFor(new Float32Array(8_000));
	try {
		const result = await controller.actions.nyquist.evaluate({ source: plugin.source, role: 'generate', name: plugin.name,
			controls: { channels: 1, spread: 80, fade: 0, count: 1, 'surf-type': 1, 'start-f': 100, 'end-f': 1_000,
				'sweep-t': 0.2, 'pause-t': 0.2, 'crash-f': 300, boost: 24, 'crash-t': 0.2, 'post-t': 0.2 } });
		assert.ok(result && typeof result === 'object' && 'frameCount' in result);
		assert.equal(result.frameCount, 6_400);
	} finally { await controller.dispose(); }
});

test('published Trim Silence finds selected clips after an earlier-created clip was moved later', async () => {
	const plugin = await installPlugin('TrimSilence.ny');
	const input = Float32Array.from({ length: 8_000 }, (_, i) => i < 800 || i >= 7_200 ? 0 : 0.2 * Math.cos(i * Math.PI / 10));
	const { controller } = await controllerFor(input, true);
	try {
		const result = await controller.actions.nyquist.evaluate({ source: plugin.source, role: 'process',
			name: plugin.name, controls: { threshold: -48, 'min-start-silence': 0, 'min-end-silence': 0 } });
		assert.ok(result && typeof result === 'object' && 'frameCount' in result);
		assert.ok(typeof result.frameCount === 'number' && result.frameCount >= 6_300 && result.frameCount <= 6_500);
	} finally { await controller.dispose(); }
});

async function controllerFor(input: Float32Array, movedClip = false) {
	const { store, project } = await createFixture('nyquist-host-compatibility', { sampleRate: 8_000,
		tracks: [{ id: 'voice', name: 'Voice', input }] });
	if (movedClip) await store.saveProject(createCurrentAudioEditorProject({ id: project.id, sampleRate: 8_000,
		sources: project.sources, tracks: [{ id: 'voice', type: 'audio', clipIds: ['late', 'early'] }],
		clips: [
			{ id: 'late', sourceId: 'voice-source', timelineStartFrame: 16_000, sourceStartFrame: 0, sourceDurationFrames: 8_000, durationFrames: 8_000 },
			{ id: 'early', sourceId: 'voice-source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 8_000, durationFrames: 8_000 },
		] }));
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const controller = createController(store, new Map([['voice', input]]),
		(request: Parameters<typeof runtime.evaluate>[0]) => Promise.resolve(runtime.evaluate(request)));
	await controller.ready;
	controller.actions.timeline.selectTrack('voice');
	controller.actions.timeline.setSelection(0, input.length, { trackIds: ['voice'], clipIds: [] });
	return { controller };
}

async function installPlugin(fileName: string) {
	const fixture = new URL('./fixtures/nyquist-archive/', import.meta.url);
	const manifest = await parseNyquistArchiveManifest(gunzipSync(readFileSync(new URL('manifest.json.gz', fixture))));
	const artifact = manifest.artifacts.find((entry: { fileName: string }) => entry.fileName === fileName);
	assert.ok(artifact);
	const bytes = gunzipSync(readFileSync(new URL(`${fileName}.gz`, fixture)));
	const store = createNyquistArchiveStore({ getItem: () => null, setItem: () => undefined });
	const plugin = await installNyquistArchivePlugin(store, artifact, { fetchImpl: async () => new Response(bytes) });
	const source = store.source(plugin.id);
	assert.equal(typeof source, 'string');
	return { source, name: plugin.name };
}
