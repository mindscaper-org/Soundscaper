/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { WORKER_EFFECT_CONTRACT_CHUNK_TEST } from '../scripts/lib/build-worker-chunk-groups.mjs';
import { DESKTOP_EFFECT_RUNTIME_FILES } from '../scripts/lib/desktop-effect-runtime-files.mjs';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';

test('Auto-Tune metadata shares the effect contract owner while its admission shares the domain', () => {
	const root = 'src/common/editor/first-party-effects/auto-tune/';
	for (const [module, owner] of [['definition', 'editor-effect-contracts'], ['contract', 'editor-domain']] as const) {
		for (const path of [`${root}${module}.ts`, `${root}${module}.ts`.replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(path), owner, path);
		}
	}
	assert.equal(WORKER_EFFECT_CONTRACT_CHUNK_TEST.test(`${root}definition.ts`), true);
	for (const module of ['selection', 'pitch']) {
		assert.notEqual(chunkGroupForModulePath(`${root}${module}.ts`), 'editor-effect-contracts');
		assert.equal(WORKER_EFFECT_CONTRACT_CHUNK_TEST.test(`${root}${module}.ts`), false);
	}
});

test('desktop effect registry ships the new definition it imports', () => {
	const path = 'src/common/editor/first-party-effects/auto-tune/definition.js';
	assert.equal(DESKTOP_EFFECT_RUNTIME_FILES.includes(path), true);
	assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.includes(path), true);
});
