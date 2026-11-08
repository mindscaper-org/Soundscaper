/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { lightscaperDesktopProductMetadataPluginCurrentV1 } from '../scripts/lib/desktop-lightscaper-product-metadata-plugin-current-v1.ts';

const execute = promisify(execFile);

test('Lightscaper bundled main reads staged metadata when no product environment is set', async context => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-main-metadata-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const repositoryRoot = join(root, 'source'), source = join(repositoryRoot, 'desktop');
	const output = join(root, 'application/desktop');
	await mkdir(source, { recursive: true }); await mkdir(output, { recursive: true });
	await writeFile(join(source, 'product.json'), JSON.stringify({ id: 'soundscaper', applicationVersion: '1.0.0-rc.Oct.13.a' }));
	await writeFile(join(source, 'constants.js'), await readFile(new URL('../desktop/constants.js', import.meta.url), 'utf8'));
	await writeFile(join(repositoryRoot, 'entry.mjs'), [
		"import { PRODUCT_ID, DECLARED_APPLICATION_VERSION, APP_ORIGIN } from './desktop/constants.js';",
		'export const packaged = { id: PRODUCT_ID, applicationVersion: DECLARED_APPLICATION_VERSION, origin: APP_ORIGIN };',
	].join('\n'));
	const outfile = join(output, 'main.mjs');
	const built = await build({ entryPoints: [join(repositoryRoot, 'entry.mjs')], outfile,
		bundle: true, platform: 'node', format: 'esm', target: 'node26', metafile: true,
		plugins: [lightscaperDesktopProductMetadataPluginCurrentV1(repositoryRoot)] });
	const expected = { id: 'lightscaper', applicationVersion: '0.1.0-beta.1', origin: 'lightscaper-app://bundle' };
	await writeFile(join(output, 'product.json'), JSON.stringify({ schemaVersion: 1, id: expected.id,
		applicationVersion: expected.applicationVersion, applicationVersionChannel: 'candidate', releaseChannel: 'deferred', updateTagPrefix: 'lightscaper-v' }));
	const environment: NodeJS.ProcessEnv = { ...process.env }; delete environment.SCAPE_PRODUCT;
	const result = await execute(process.execPath, ['--input-type=module', '--eval',
		`const module = await import(${JSON.stringify(pathToFileURL(outfile).href)}); process.stdout.write(JSON.stringify(module.packaged));`], { env: environment });
	assert.deepEqual(JSON.parse(result.stdout), expected);
	const external = Object.values(built.metafile.outputs).flatMap(item => item.imports).filter(item => item.external);
	assert.deepEqual(external.map(item => item.path), ['./product.json']);
});

test('Lightscaper metadata plugin does not externalize unrelated product JSON imports', async context => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-main-metadata-scope-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'other'), { recursive: true });
	await writeFile(join(root, 'other/product.json'), JSON.stringify({ id: 'foreign-must-bundle' }));
	await writeFile(join(root, 'other/module.mjs'), "import value from './product.json' with { type: 'json' }; export default value;");
	const built = await build({ entryPoints: [join(root, 'other/module.mjs')], bundle: true, platform: 'node',
		format: 'esm', target: 'node26', write: false, metafile: true,
		plugins: [lightscaperDesktopProductMetadataPluginCurrentV1(root)] });
	assert.match(built.outputFiles[0]!.text, /foreign-must-bundle/u);
	assert.deepEqual(Object.values(built.metafile.outputs).flatMap(item => item.imports).filter(item => item.external), []);
	assert.throws(() => lightscaperDesktopProductMetadataPluginCurrentV1('relative/source'), TypeError);
});
