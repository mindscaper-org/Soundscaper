/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { buildTracktionProjectWorker } from '../scripts/lib/tracktion-editor-build.mjs';

function bootWorker(code: string, ready: boolean) {
	const events = new EventTarget();
	const messages: unknown[] = [];
	const scope = {
		AbortController,
		URL,
		TextDecoder,
		TextEncoder,
		location: { href: 'https://soundscaper.test/tracktion/tracktion-project-worker.js' },
		Module: undefined as { HEAPU8?: Uint8Array; tracktionReady(): void } | undefined,
		addEventListener: events.addEventListener.bind(events),
		postMessage: (message: unknown) => messages.push(message),
		importScripts: (url: string) => {
			assert.equal(url, 'https://soundscaper.test/tracktion/edit-core.js');
			if (!ready) return;
			assert.ok(scope.Module);
			scope.Module.HEAPU8 = new Uint8Array(128);
			scope.Module.tracktionReady();
		},
	};
	runInNewContext(code, scope);
	return { events, messages };
}

test('the Tracktion worker reports a failed WASM fetch during startup', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'tracktion-wasm-bootstrap-'));
	context.after(async () => { await rm(directory, { force: true, recursive: true }); });
	await buildTracktionProjectWorker(directory);
	const code = await readFile(join(directory, 'tracktion-project-worker.js'), 'utf8');
	const rejectFetch = () => Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason: new TypeError('Failed to fetch') });

	const starting = bootWorker(code, false);
	assert.equal(starting.events.dispatchEvent(rejectFetch()), false);
	assert.deepEqual(structuredClone(starting.messages), [{ fatal: 'TypeError: Failed to fetch' }]);
	starting.events.dispatchEvent(rejectFetch());
	assert.equal(starting.messages.length, 1);

	const ready = bootWorker(code, true);
	assert.equal(ready.events.dispatchEvent(rejectFetch()), true);
	assert.equal(ready.messages.length, 0);
});
