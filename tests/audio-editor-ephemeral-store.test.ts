/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperEphemeralProjectStore, createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('temporary Soundscaper stores isolate each file from other batches and the degraded project library', async t => {
	const library = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const first = createSoundscaperEphemeralProjectStore(), second = createSoundscaperEphemeralProjectStore();
	t.after(async () => { await Promise.all([library.close(), first.close(), second.close()]); });
	await library.saveProject(createSoundscaperProject({ id: 'visible-project' }));
	await first.saveProject(createSoundscaperProject({ id: 'first-file' }));
	assert.equal(await first.loadProject('visible-project'), null);
	assert.equal(await second.loadProject('first-file'), null);
	assert.equal(await library.loadProject('first-file'), null);
	assert.equal((await first.loadProject('first-file'))?.id, 'first-file');
	assert.throws(() => createSoundscaperProjectStore({ ephemeralMemory: true }), /authority override/);
});
