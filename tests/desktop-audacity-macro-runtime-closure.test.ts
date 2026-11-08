/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-expected-runtime-files.mjs';

test('desktop macro effect inventory matches the pure profile dependency graph', async () => {
	const entry = 'src/common/editor/audacity-macro-commands.js';
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(entry));
	const result = await build({
		absWorkingDir: resolve(import.meta.dirname, '..'),
		entryPoints: [entry],
		bundle: true,
		platform: 'node',
		packages: 'external',
		write: false,
		metafile: true,
		logLevel: 'silent',
	});
	const effectProfiles = Object.keys(result.metafile.inputs)
		.filter(file => file.startsWith('src/common/editor/aup4-')).sort();
	assert.deepEqual(effectProfiles, [
		'src/common/editor/aup4-effect-profiles.js',
		'src/common/editor/aup4-effect-xml-values.js',
	]);
	assert.deepEqual(DESKTOP_EXPECTED_RUNTIME_FILES
		.filter(file => file.startsWith('src/common/editor/aup4-')).sort(), effectProfiles);
});
