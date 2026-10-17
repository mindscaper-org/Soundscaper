/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_CONFIG = './electron-builder.config.cjs';
const PHOTO_CONFIG = './electron-builder.lightscaper.config.cjs';

interface Configuration {
	readonly appId: string;
	readonly productName: string;
	readonly directories: { readonly app: string; readonly buildResources: string };
	readonly extraResources: readonly { readonly from: string; readonly to: string }[];
	readonly beforePack: string;
	readonly afterPack: string;
	readonly fileAssociations?: unknown;
}

test('Lightscaper public builder entry selects the complete dedicated photo configuration', () => {
	const selected = configuration();
	assert.deepEqual(selected, configuration({ config: PHOTO_CONFIG }));
	assert.equal(selected.appId, 'org.lightscaper.desktop');
	assert.equal(selected.productName, 'Lightscaper');
	assert.equal(selected.beforePack, './scripts/desktop-lightscaper-before-pack.mjs');
	assert.equal(selected.afterPack, './scripts/desktop-lightscaper-after-pack.mjs');
	assert.equal(selected.fileAssociations, undefined);
});

test('Lightscaper public builder selects every resource from the same custom preparation root', () => {
	for (const buildRoot of ['/tmp/Lightscaper verification/stage', 'private-builds/photo stage']) {
		const selected = configuration({ buildRoot });
		const root = resolve(ROOT, buildRoot);
		assert.deepEqual(selected, configuration({ buildRoot, config: PHOTO_CONFIG }));
		assert.equal(selected.directories.app, resolve(root, 'app'));
		assert.equal(selected.directories.buildResources, resolve(root, 'icons'));
		assert.deepEqual(selected.extraResources, [
			{ from: resolve(root, 'renderer'), to: 'renderer' },
			{ from: resolve(root, 'runtime'), to: 'runtime' },
			{ from: resolve(root, 'licenses'), to: 'licenses' },
		]);
	}
});

test('Lightscaper default public builder paths retain the standard stage location', () => {
	const selected = configuration();
	assert.equal(selected.directories.app, '.desktop-build/app');
	assert.equal(selected.directories.buildResources, '.desktop-build/icons');
	assert.deepEqual(selected.extraResources, [
		{ from: '.desktop-build/renderer', to: 'renderer' },
		{ from: '.desktop-build/runtime', to: 'runtime' },
		{ from: '.desktop-build/licenses', to: 'licenses' },
	]);
});

test('Lightscaper builder rejects an empty custom root rather than selecting an unrelated stage', () => {
	for (const config of [PUBLIC_CONFIG, PHOTO_CONFIG]) {
		const result = runConfiguration({ config, buildRoot: '' });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /SCAPE_DESKTOP_BUILD_ROOT.*non-empty/iu);
	}
});

test('Lightscaper public builder refuses misspelled and empty product selections', () => {
	for (const product of ['', 'Lightscaper', 'lightscaper ', 'unknown']) {
		const result = runConfiguration({ product });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /SCAPE_PRODUCT/iu);
	}
});

function configuration(options: Parameters<typeof runConfiguration>[0] = {}): Configuration {
	const result = runConfiguration(options);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout) as Configuration;
}

function runConfiguration({ product = 'lightscaper', config = PUBLIC_CONFIG, buildRoot }: {
	product?: string; config?: string; buildRoot?: string;
} = {}) {
	const env: NodeJS.ProcessEnv = { ...process.env, SCAPE_PRODUCT: product, SCAPE_MAC_SIGNING: 'false', SCAPE_WIN_SIGNING: 'none' };
	if (buildRoot === undefined) delete env.SCAPE_DESKTOP_BUILD_ROOT;
	else env.SCAPE_DESKTOP_BUILD_ROOT = buildRoot;
	return spawnSync(process.execPath, ['--eval', `process.stdout.write(JSON.stringify(require(${JSON.stringify(config)})));`], {
		cwd: ROOT, env, encoding: 'utf8', timeout: 10_000,
	});
}
