/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Arch } from 'builder-util';
import type { Configuration } from 'electron-builder';

import { prepareDesktopAppxAssets } from '../scripts/desktop-appx-assets.mjs';

test('AppX preparation uses the product artwork and preserves builder manifest substitutions', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-appx-assets-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await prepareDesktopAppxAssets({ repositoryRoot: resolve(import.meta.dirname, '..'), outputRoot: root,
		productId: 'soundscaper', version: '1.0.27.0' });
	const manifest = await readFile(join(root, 'appxmanifest.xml'), 'utf8');
	assert.match(manifest, /Version="1\.0\.27\.0"/u);
	assert.match(manifest, /Name="\$\{identityName\}"/u);
	assert.match(manifest, /Publisher="\$\{publisher\}"/u);
	assert.match(manifest, /\$\{extensions\}/u);
	assert.match(manifest, /\$\{capabilities\}/u);
	const dimensions = { 'StoreLogo.png': [50, 50], 'Square44x44Logo.png': [44, 44],
		'Square150x150Logo.png': [150, 150], 'Wide310x150Logo.png': [310, 150] };
	assert.deepEqual((await readdir(join(root, 'appx'))).sort(), Object.keys(dimensions).sort());
	for (const [name, size] of Object.entries(dimensions)) {
		const png = await readFile(join(root, 'appx', name));
		assert.equal(png.subarray(1, 4).toString(), 'PNG');
		assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], size);
	}
	const soundscaper = await readFile(join(root, 'appx', 'StoreLogo.png'));
	await prepareDesktopAppxAssets({ repositoryRoot: resolve(import.meta.dirname, '..'), outputRoot: root,
		productId: 'framescaper', version: '1.0.28.0' });
	assert.notDeepEqual(await readFile(join(root, 'appx', 'StoreLogo.png')), soundscaper);
});

test('the actual AppX manifest generator emits both architectures, Store version, capabilities and associations', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-appx-manifest-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await prepareDesktopAppxAssets({ repositoryRoot: resolve(import.meta.dirname, '..'), outputRoot: root,
		productId: 'soundscaper', version: '1.0.27.0' });
	const require = createRequire(import.meta.url);
	const { default: AppXTarget } = require('app-builder-lib/out/targets/AppxTarget.js') as { default: { prototype: object } };
	const { createDesktopAppxConfig } = require('../scripts/lib/desktop-appx-config.cjs');
	const config = createDesktopAppxConfig(require('../electron-builder.config.cjs'), {
		SCAPE_APPX_IDENTITY_NAME: '12345.MindscaperSoundscaper', SCAPE_APPX_PUBLISHER: 'CN=StoreIdentity',
		SCAPE_APPX_PUBLISHER_DISPLAY_NAME: 'Mindscaper & Friends', SCAPE_APPX_VERSION: '1.0.27.0',
	}) as Configuration;
	const target = Object.assign(Object.create(AppXTarget.prototype) as {
		writeManifest: (path: string, arch: Arch, publisher: string, assets: string[]) => Promise<void>;
	}, { options: config.appx, packager: { config, platformSpecificBuildOptions: config.win, info: { metadata: {} },
		getResource: async (name: string) => join(root, name),
		appInfo: { productFilename: 'Soundscaper', productName: 'Soundscaper', name: 'soundscaper-desktop',
			getVersionInWeirdWindowsForm: () => { assert.fail('Store version must not overwrite the application RC version'); } },
	} });
	for (const arch of [Arch.x64, Arch.arm64]) {
		const path = join(root, `manifest-${arch}.xml`);
		await target.writeManifest(path, arch, 'CN=StoreIdentity', []);
		const manifest = await readFile(path, 'utf8');
		assert.match(manifest, /Name="12345\.MindscaperSoundscaper"/u);
		assert.match(manifest, /Version="1\.0\.27\.0"/u);
		assert.match(manifest, new RegExp(`ProcessorArchitecture="${arch === Arch.x64 ? 'x64' : 'arm64'}"`));
		assert.match(manifest, /Mindscaper &amp; Friends/u);
		assert.match(manifest, /Name="runFullTrust"/u);
		assert.match(manifest, /<uap:FileType>\.sscape<\/uap:FileType>/u);
		assert.match(manifest, /<uap:FileType>\.aup4<\/uap:FileType>/u);
		assert.doesNotMatch(manifest, /startupTask|\$\{/u);
	}
});
