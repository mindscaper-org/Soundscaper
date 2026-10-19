/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';

import { sourceModules } from './helpers/eager-chunk-group-crossings.ts';

test('source inventories normalize directory separators before matching chunk owners', async context => {
	const root = await mkdtemp(join(tmpdir(), 'chunk-source-modules-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'nested'));
	await writeFile(join(root, 'entry.js'), '');
	await writeFile(join(root, 'nested', 'leaf.ts'), '');
	await writeFile(join(root, 'ignored.json'), '{}');
	const expected = [join(root, 'entry.js'), join(root, 'nested', 'leaf.ts')];
	assert.deepEqual(sourceModules(root), expected);
	assert.deepEqual(sourceModules(root + sep), expected);
});
