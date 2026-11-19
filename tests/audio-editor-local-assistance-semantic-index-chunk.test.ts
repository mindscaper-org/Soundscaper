/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

test('semantic-index merging stays with its optional assistance custody owner', () => {
	const custody = fileURLToPath(new URL('../src/common/editor/controller/assistance/local-assistance-semantic-index-custody.ts', import.meta.url));
	const dependencies = staticRelativeDependencies(readFileSync(custody, 'utf8')).filter(path => path.endsWith('semantic-index-merge.ts'));
	assert.equal(dependencies.length, 1);
	const helper = resolveRelativeModule(custody, dependencies[0]!);
	assert.ok(helper);
	const owner = chunkGroupForModulePath(custody);
	assert.equal(owner, 'editor-optional-assistance');
	for (const path of [helper, helper.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(path), owner, path);
});
