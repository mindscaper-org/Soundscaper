/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { installNyquistArchivePlugin, parseNyquistArchiveManifest } from '../src/common/editor/nyquist/archive-catalog.js';
import { createNyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';

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
