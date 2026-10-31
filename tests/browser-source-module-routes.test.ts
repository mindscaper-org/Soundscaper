/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileSourceModuleRoutes } from './browser/helpers/source-module-routes.ts';

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'browser-source-modules-'));
	const common = join(directory, 'src/common');
	for (const name of ['editor', 'foundation', 'imaging']) await mkdir(join(common, name), { recursive: true });
	await writeFile(join(common, 'editor/entry.ts'), "import { pixel } from '../imaging/pixel.js'; export const result: number = pixel;");
	await writeFile(join(common, 'imaging/pixel.ts'), "import type { Erased } from '../editor/absent-type.ts'; import { value } from '../foundation/value.ts'; export const pixel: number = value;");
	await writeFile(join(common, 'foundation/value.ts'), 'export const value: number = 42;');
	return { directory, common, sourceRoot: pathToFileURL(`${common}/`), entry: pathToFileURL(join(common, 'editor/entry.ts')) };
}

void test('browser source routes retain common module paths across editor, imaging, and foundation', async () => {
	const setup = await fixture();
	try {
		const prefix = '/fixture/src/common';
		const routes = await transpileSourceModuleRoutes(setup.sourceRoot, prefix, [setup.entry]);
		for (const file of ['editor/entry', 'imaging/pixel', 'foundation/value']) {
			assert.ok(routes.has(`${prefix}/${file}.ts`), `missing source route ${file}`);
			assert.equal(routes.get(`${prefix}/${file}.js`), routes.get(`${prefix}/${file}.ts`));
		}
		const entry = routes.get(`${prefix}/editor/entry.ts`)!;
		assert.equal(entry.contentType, 'text/javascript');
		assert.match(entry.body, /\.\.\/imaging\/pixel\.js/u);
		const imported = new URL('../imaging/pixel.js', `https://fixture.invalid${prefix}/editor/entry.ts`);
		assert.ok(routes.has(imported.pathname));
		assert.doesNotMatch(routes.get(`${prefix}/imaging/pixel.ts`)!.body, /absent-type/u);
		assert.equal(routes.size, 6, 'erased types do not become browser requests');
	} finally { await rm(setup.directory, { recursive: true, force: true }); }
});

void test('browser source closures reject runtime imports outside their declared source root', async () => {
	const setup = await fixture();
	try {
		await writeFile(join(setup.common, 'editor/entry.ts'), "import '../../../outside.ts';");
		await assert.rejects(transpileSourceModuleRoutes(setup.sourceRoot, '/fixture/src/common', [setup.entry]), /outside.*source root/u);
	} finally { await rm(setup.directory, { recursive: true, force: true }); }
});

void test('browser source closures fail when an actual runtime dependency is missing', async () => {
	const setup = await fixture();
	try {
		await writeFile(join(setup.common, 'editor/entry.ts'), "import '../foundation/missing.ts';");
		await assert.rejects(transpileSourceModuleRoutes(setup.sourceRoot, '/fixture/src/common', [setup.entry]), /ENOENT/u);
	} finally { await rm(setup.directory, { recursive: true, force: true }); }
});
