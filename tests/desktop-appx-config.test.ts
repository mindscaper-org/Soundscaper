/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { validateConfiguration } from 'app-builder-lib/out/util/config/config.js';
import { DebugLogger } from 'builder-util';

const require = createRequire(import.meta.url);
const { desktopAppxSettings, createDesktopAppxConfig } = require('../scripts/lib/desktop-appx-config.cjs');
const environment = {
	SCAPE_APPX_IDENTITY_NAME: '12345.MindscaperSoundscaper',
	SCAPE_APPX_PUBLISHER: 'CN=00000000-0000-0000-0000-000000000000',
	SCAPE_APPX_PUBLISHER_DISPLAY_NAME: 'Mindscaper',
	SCAPE_APPX_VERSION: '1.0.27.0',
};

test('AppX requires explicit Store identity and a distinct numeric version', () => {
	assert.throws(() => desktopAppxSettings({}), /SCAPE_APPX_IDENTITY_NAME/u);
	for (const key of Object.keys(environment)) {
		assert.throws(() => desktopAppxSettings({ ...environment, [key]: '' }), new RegExp(key));
	}
	for (const version of ['1.0.0-rc.Nov.9.b', '1.0.0', '1.0.0.1', '0.1.0.0', '1.65536.0.0', '01.0.0.0']) {
		assert.throws(() => desktopAppxSettings({ ...environment, SCAPE_APPX_VERSION: version }), /SCAPE_APPX_VERSION/u);
	}
	assert.equal(desktopAppxSettings(environment).version, '1.0.27.0');
	assert.throws(() => desktopAppxSettings({ ...environment, SCAPE_APPX_IDENTITY_NAME: '../Bad' }), /IDENTITY_NAME/u);
	assert.throws(() => desktopAppxSettings({ ...environment, SCAPE_APPX_PUBLISHER: 'Mindscaper' }), /PUBLISHER/u);
});

test('AppX retains native packaging guards and file associations without modifying installer configuration', () => {
	const base = require('../electron-builder.config.cjs');
	const before = structuredClone(base);
	const config = createDesktopAppxConfig(base, environment);
	assert.deepEqual(base, before);
	assert.deepEqual(config.win.target, ['appx']);
	assert.equal(config.beforePack, base.beforePack);
	assert.equal(config.afterPack, base.afterPack);
	assert.deepEqual(config.extraResources, base.extraResources);
	assert.deepEqual(config.fileAssociations, base.fileAssociations);
	assert.equal(config.win.signExecutable, false);
	assert.equal(config.forceCodeSigning, false);
	assert.equal(config.afterSign, null);
	assert.equal(config.appx.identityName, environment.SCAPE_APPX_IDENTITY_NAME);
	assert.equal(config.appx.publisher, environment.SCAPE_APPX_PUBLISHER);
	assert.equal(config.appx.applicationId, 'Soundscaper');
	assert.equal(config.appx.setBuildNumber, false);
	assert.equal(config.directories.output, 'release/appx');
	assert.deepEqual(config.appx.capabilities, ['runFullTrust']);
	assert.equal(config.appx.addAutoLaunchExtension, false);
});

test('the pinned electron-builder accepts the complete AppX configuration', async () => {
	await validateConfiguration(createDesktopAppxConfig(require('../electron-builder.config.cjs'), environment), new DebugLogger());
});
