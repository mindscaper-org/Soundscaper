/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { installNyquistArchivePlugin, parseNyquistArchiveManifest } from '../src/common/editor/nyquist/archive-catalog.js';
import { createNyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';
import { evaluateNyquist, loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';

test('authenticated HQ-Tone installation retains its published selectable waveform and smoothing options', async () => {
	const fixture = new URL('./fixtures/nyquist-archive/', import.meta.url);
	const manifest = await parseNyquistArchiveManifest(gunzipSync(readFileSync(new URL('manifest.json.gz', fixture))));
	const artifact = manifest.artifacts.find((entry: { fileName: string }) => entry.fileName === 'HQ-Tone.ny');
	assert.ok(artifact);
	const bytes = gunzipSync(readFileSync(new URL('HQ-Tone.ny.gz', fixture)));
	const saved = new Map<string, string>();
	const store = createNyquistArchiveStore({ getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => { saved.set(key, value); } });
	await installNyquistArchivePlugin(store, artifact, { fetchImpl: async () => new Response(bytes) });
	for (const installed of [store, createNyquistArchiveStore(store.storage)]) {
		const plugin = installed.list()[0];
		assert.ok(plugin);
		const wave = plugin.controls.find((control: { variable: string }) => control.variable === 'wave');
		assert.deepEqual(wave?.options.map((option: { value: number; label: string }) => [option.value, option.label]),
			[[0, 'Sine'], [1, 'Square'], [2, 'Triangle'], [3, 'Saw'], [4, 'Inverse Saw']]);
		assert.equal(wave?.defaultValue, 1);
		assert.equal(installed.source(plugin.id), bytes.toString('utf8'));
		assert.deepEqual(plugin.controls.find((control: { variable: string }) => control.variable === 'smooth')?.options
			.map((option: { value: number; label: string }) => [option.value, option.label]), [[0, 'Enabled'], [1, 'Disabled']]);
	}
});

test('the authenticated published Chimes Delay processes audio with its string note-list control', async () => {
	const fixture = new URL('./fixtures/nyquist-archive/', import.meta.url);
	const manifest = await parseNyquistArchiveManifest(gunzipSync(readFileSync(new URL('manifest.json.gz', fixture))));
	const artifact = manifest.artifacts.find((entry: { fileName: string }) => entry.fileName === 'Chimesdelay3.ny');
	assert.ok(artifact);
	const bytes = gunzipSync(readFileSync(new URL('Chimesdelay3.ny.gz', fixture)));
	const store = createNyquistArchiveStore({ getItem: () => null, setItem: () => undefined });
	const plugin = await installNyquistArchivePlugin(store, artifact, { fetchImpl: async () => new Response(bytes) });
	const source = store.source(plugin.id);
	assert.equal(typeof source, 'string');
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const input = Float32Array.from({ length: 4_410 }, (_, i) => 0.2 * Math.sin(i * 2 * Math.PI * 440 / 44_100));
	const result = await evaluateNyquist({ source, sampleRate: 44_100, channels: [input], maxOutputFrames: 44_100,
		controls: { chimeslist: '0 7 12', lownote: 0, highnote: 12, maxdelay: 0.5, minvol: 50, count: 1 } }, runtime);
	assert.equal(result.type, 'audio');
	assert.ok(result.frameCount >= input.length);
	assert.ok(result.channels[0].some((value: number) => Math.abs(value) > 0.01));
});
