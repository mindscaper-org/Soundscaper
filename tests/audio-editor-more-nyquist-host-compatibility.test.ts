/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { installNyquistArchivePlugin, parseNyquistArchiveManifest } from '../src/common/editor/nyquist/archive-catalog.js';
import { createNyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createController, createFixture } from './helpers/audio-editor-nyquist-controller-harness.js';

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

async function controllerFor(input: Float32Array) {
	const { store } = await createFixture('nyquist-host-compatibility', { sampleRate: 8_000,
		tracks: [{ id: 'voice', name: 'Voice', input }] });
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
