/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { installNyquistArchivePlugin, parseNyquistArchiveManifest } from '../src/common/editor/nyquist/archive-catalog.js';
import { createNyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';

test('closing Get effects during source verification cannot install the cancelled plug-in', async t => {
	const fixture = new URL('./fixtures/nyquist-archive/', import.meta.url);
	const manifest = await parseNyquistArchiveManifest(gunzipSync(readFileSync(new URL('manifest.json.gz', fixture))));
	const artifact = manifest.artifacts.find((entry: { fileName: string }) => entry.fileName === 'HQ-Tone.ny');
	assert.ok(artifact);
	const bytes = gunzipSync(readFileSync(new URL('HQ-Tone.ny.gz', fixture)));
	const saved = new Map<string, string>();
	const store = createNyquistArchiveStore({ getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => { saved.set(key, value); } });
	const cancellation = new AbortController();
	const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
	t.mock.method(globalThis.crypto.subtle, 'digest', async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
		const result = await digest(algorithm, data);
		cancellation.abort();
		return result;
	});
	await assert.rejects(installNyquistArchivePlugin(store, artifact, {
		fetchImpl: async () => new Response(bytes), signal: cancellation.signal,
	}), { name: 'AbortError' });
	assert.equal(store.list().length, 0);
	assert.equal(saved.size, 0);
});
