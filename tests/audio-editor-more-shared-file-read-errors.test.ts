/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSharedFiles, sharedFilesManifestUrl, sharedFilesBodyUrl } from '../src/common/offline/share-target-launch.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createAudioEditorController, createMemoryEngine, createProjectStore, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const failureAt of ['lookup', 'read'] as const) test(`an OS share retains healthy audio around a ${failureAt} failure`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `share-io-${failureAt}` });
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY,
		store, projectRuntime, sessionController: projectRuntime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const bytes = Uint8Array.from(encodeWav([new Float32Array(8)], { sampleRate: 48_000 }));
	const token = 'a'.repeat(32);
	const entries = new Map<string, Uint8Array<ArrayBuffer>>([[sharedFilesManifestUrl(token), new TextEncoder().encode(JSON.stringify({ schemaVersion: 1,
		files: ['before.wav', 'unreadable.wav', 'after.wav'].map(name => ({ name, type: 'audio/wav', byteLength: bytes.length })) }))],
		...[0, 1, 2].map(index => [sharedFilesBodyUrl(token, index), bytes] as const)]);
	const failure = new Error('The shared recording could not be read from browser storage.');
	const errors: unknown[] = [];
	const result = await collectSharedFiles({ href: `https://soundscaper.org/en/?share=${token}`, replaceAddress() {},
		onError: error => { errors.push(error); }, deliver: launch => controller.actions.project.importFiles(launch.files),
		caches: { open: () => Promise.resolve({
			match: (url: string) => {
				if (url === sharedFilesBodyUrl(token, 1)) {
					if (failureAt === 'lookup') return Promise.reject(failure);
					return Promise.resolve(new Response(new ReadableStream({ pull() { throw failure; } })));
				}
				const body = entries.get(url);
				return Promise.resolve(body ? new Response(body) : undefined);
			}, delete: (url: string) => Promise.resolve(entries.delete(url)),
		}) },
	});
	assert.equal(result.status, 'collected');
	assert.deepEqual(controller.project?.sources.map(source => source.name), ['before.wav', 'after.wav']);
	assert.deepEqual(errors, [failure]);
	assert.equal(entries.size, 0, 'the consumed one-time share must still be cleaned up');
});
