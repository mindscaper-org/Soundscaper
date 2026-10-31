/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

import { productProfileChunkGroups } from '../scripts/lib/build-chunk-product-profiles.mjs';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

const PROFILE_MODULES = [
	'src/common/product-profiles.js',
	'src/common/product-capabilities.js',
	'src/common/project-file-extensions.ts',
	'src/common/products.js',
] as const;
const IDENTITY_MODULE = 'src/common/product-identities.js';

test('common product profiles have an exact owner apart from editor and initial-page roles', () => {
	assert.equal(productProfileChunkGroups.length, 1);
	const group = productProfileChunkGroups[0];
	assert.ok(group);
	assert.equal(group.name, 'product-profiles');
	assert.ok(group.test instanceof RegExp);
	assert.equal(group.includeDependenciesRecursively, false);
	for (const path of PROFILE_MODULES) {
		for (const separator of ['/', '\\']) {
			assert.equal(group.test.test(path.replaceAll('/', separator)), true, path);
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), group.name, path);
			for (const foreign of [path + '.foreign', path.replace('common/', 'common/internal/'), path.replace(/\.(?:js|ts)$/u, '-future.ts')]) {
				assert.equal(group.test.test(foreign.replaceAll('/', separator)), false, foreign);
			}
		}
	}
	assert.equal(group.test.test(IDENTITY_MODULE), false);
	assert.equal(chunkGroupForModulePath(IDENTITY_MODULE), null);
	const siteEntry = chunkGroups.find(candidate => candidate.name === 'site-entry');
	assert.ok(siteEntry);
	assert.deepEqual(siteEntry.tags, ['$initial']);
	assert.ok((siteEntry.priority ?? 0) > (group.priority ?? 0));
});

test('product profile runtime closure contains only common metadata and the initial identity leaf', () => {
	const result = buildSync({
		absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
		entryPoints: [...PROFILE_MODULES],
		outdir: 'product-profile-chunk-test-output',
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		write: false,
		metafile: true,
	});
	const expected: readonly string[] = [...PROFILE_MODULES, IDENTITY_MODULE].sort();
	assert.deepEqual(Object.keys(result.metafile.inputs).sort(), expected);
	for (const [path, input] of Object.entries(result.metafile.inputs)) {
		for (const dependency of input.imports) {
			assert.equal(dependency.external, undefined, `${path}: ${dependency.path}`);
			assert.equal(dependency.kind, 'import-statement', `${path}: ${dependency.path}`);
			assert.ok(expected.includes(dependency.path), `${path}: ${dependency.path}`);
		}
	}
	assert.deepEqual(result.metafile.inputs[IDENTITY_MODULE]?.imports, []);
});
