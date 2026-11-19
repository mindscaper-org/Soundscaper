/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { bundleSourceModuleRoutes } from './browser/helpers/source-module-routes.ts';

const prefix = '/fixture/src/common';

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'browser-source-modules-'));
	const common = join(directory, 'src/common');
	const dependency = join(directory, 'node_modules/fixture-dependency');
	for (const folder of [join(common, 'editor'), join(common, 'imaging'), dependency]) {
		await mkdir(folder, { recursive: true });
	}
	await writeFile(join(common, 'editor/entry.ts'), "export { pixel as result } from '../imaging/pixel.js';");
	await writeFile(join(common, 'editor/peer.ts'), "export { pixel as witness } from '../imaging/pixel.js';");
	await writeFile(join(common, 'imaging/pixel.ts'),
		"import type { Erased } from '../editor/absent-type.ts'; export { value as pixel } from 'fixture-dependency';");
	await writeFile(join(dependency, 'package.json'), '{"name":"fixture-dependency","type":"module","exports":"./index.js"}');
	await writeFile(join(dependency, 'index.js'), 'export const value = 42;');
	return { directory, common, sourceRoot: pathToFileURL(`${common}/`), entry: pathToFileURL(join(common, 'editor/entry.ts')) };
}

void test('browser source routes keep entry paths and resolve shared local and package dependencies', async () => {
	const setup = await fixture();
	try {
		const peer = new URL('editor/peer.ts', setup.sourceRoot);
		const routes = await bundleSourceModuleRoutes(setup.sourceRoot, prefix, [setup.entry, peer]);
		assert.equal(routes.size, 3);
		let sharedChunk: string | undefined;
		for (const name of ['entry', 'peer']) {
			const url = new URL(`${prefix}/editor/${name}.js`, 'https://fixture.invalid');
			const route = routes.get(url.pathname);
			assert.ok(route);
			assert.equal(route.contentType, 'text/javascript');
			const specifier = route.body.match(/from "([^"]+)"/u)?.[1];
			assert.ok(specifier);
			const chunk = new URL(specifier, url).pathname;
			sharedChunk ??= chunk;
			assert.equal(chunk, sharedChunk);
		}
		const shared = routes.get(sharedChunk!);
		assert.ok(shared);
		assert.match(shared.body, /value = 42/u);
		assert.doesNotMatch(shared.body, /absent-type/u);
	} finally { await rm(setup.directory, { recursive: true, force: true }); }
});

void test('browser source bundles fail when a runtime dependency is missing', async () => {
	const setup = await fixture();
	try {
		await writeFile(join(setup.common, 'editor/entry.ts'), "import '../imaging/missing.ts';");
		await assert.rejects(bundleSourceModuleRoutes(setup.sourceRoot, prefix, [setup.entry]), /Could not resolve.*missing\.ts/u);
	} finally { await rm(setup.directory, { recursive: true, force: true }); }
});
