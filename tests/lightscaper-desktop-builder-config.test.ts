/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import beforePack from '../scripts/desktop-lightscaper-before-pack.mjs';
import afterPack from '../scripts/desktop-lightscaper-after-pack.mjs';
import afterSign from '../scripts/desktop-lightscaper-after-sign.mjs';
import afterAllArtifactBuild from '../scripts/desktop-verify-release-artifacts.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELECT_CONFIG = `
const config = require('./electron-builder.lightscaper.config.cjs');
process.stdout.write(JSON.stringify({
 appId: config.appId, productName: config.productName,
 directories: config.directories, win: { icon: config.win.icon },
 nsis: { perMachine: config.nsis.perMachine, allowElevation: config.nsis.allowElevation, packElevateHelper: config.nsis.packElevateHelper },
 fileAssociations: config.fileAssociations,
 mac: { icon: config.mac.icon, category: config.mac.category, entitlements: config.mac.entitlements,
  entitlementsInherit: config.mac.entitlementsInherit, extendInfo: config.mac.extendInfo, signIgnore: config.mac.signIgnore },
 linux: { icon: config.linux.icon, executableName: config.linux.executableName, category: config.linux.category },
 asar: config.asar, npmRebuild: config.npmRebuild,
 downloadAlternateFFmpeg: config.downloadAlternateFFmpeg,
 beforePack: config.beforePack, afterPack: config.afterPack,
 afterSign: config.afterSign, afterAllArtifactBuild: config.afterAllArtifactBuild,
 publish: config.publish,
}));`;

interface BuilderMetadata {
	readonly appId: string;
	readonly productName: string;
	readonly directories: { readonly app: string; readonly buildResources: string };
	readonly win: { readonly icon: string };
	readonly nsis: { readonly perMachine: boolean; readonly allowElevation: boolean; readonly packElevateHelper: boolean };
	readonly fileAssociations?: readonly { readonly ext: string | readonly string[]; readonly role: string }[];
	readonly mac: { readonly icon: string; readonly category: string; readonly entitlements: string;
		readonly entitlementsInherit: string; readonly extendInfo: Record<string, unknown>; readonly signIgnore?: unknown };
	readonly linux: { readonly icon: string; readonly executableName: string; readonly category: string };
	readonly asar: boolean;
	readonly npmRebuild: boolean;
	readonly downloadAlternateFFmpeg: boolean;
	readonly beforePack: string;
	readonly afterPack: string;
	readonly afterSign: string;
	readonly afterAllArtifactBuild: string;
	readonly publish: unknown;
}

test('Lightscaper builder owns photo identity without claiming an external archive open lifecycle', () => {
	const config = readConfiguration('lightscaper');
	assert.equal(config.appId, 'org.lightscaper.desktop');
	assert.equal(config.productName, 'Lightscaper');
	assert.equal(config.linux.executableName, 'lightscaper');
	assert.equal(config.linux.category, 'Graphics;Photography');
	assert.equal(config.mac.category, 'public.app-category.photography');
	assert.equal(config.fileAssociations, undefined);
});

test('Lightscaper icons resolve under the effective build resources directory', () => {
	const config = readConfiguration('lightscaper');
	assert.equal(config.directories.app, '.desktop-build/app');
	assert.equal(config.directories.buildResources, '.desktop-build/icons');
	assert.equal(config.win.icon, 'icon.png');
	assert.equal(config.mac.icon, 'icon.png');
	assert.equal(config.linux.icon, 'linux');
});

test('Lightscaper per-user installer omits the unneeded updater elevation helper', () => {
	const config = readConfiguration('lightscaper');
	assert.deepEqual(config.nsis, { perMachine: false, allowElevation: false, packElevateHelper: false });
});

test('Lightscaper installer settings make the installed NSIS helper resolver return no executable', () => {
	const result = runNode('lightscaper', `
const config = require('./electron-builder.lightscaper.config.cjs');
const { CopyElevateHelper } = require('app-builder-lib/out/targets/nsis/nsisUtil.js');
const packager = { info: { framework: { isCopyElevateHelper: true } } };
Object.defineProperty(packager, 'config', { get() { throw new Error('Unexpected elevation toolset resolution'); } });
new CopyElevateHelper().resolve({ packager, options: config.nsis }).then(
 value => process.stdout.write(JSON.stringify({ elevate: value })),
 error => { console.error(error); process.exitCode = 1; },
);`);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), { elevate: null });
});

test('Lightscaper builder requests no microphone, camera or screen capture permissions', async () => {
	const config = readConfiguration('lightscaper');
	assert.equal(config.mac.entitlements, 'desktop/lightscaper-entitlements.mac.plist');
	assert.equal(config.mac.entitlementsInherit, config.mac.entitlements);
	assert.deepEqual(config.mac.extendInfo, {});
	const entitlements = await readFile(new URL('../desktop/lightscaper-entitlements.mac.plist', import.meta.url), 'utf8');
	assert.deepEqual([...entitlements.matchAll(/<key>([^<]+)<\/key>/gu)].map((match) => match[1]), [
		'com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory',
	]);
	assert.doesNotMatch(entitlements, /device\.(?:audio-input|camera)|screen-recording|audio-capture/iu);
});

void test('Lightscaper builder retains runtime verification and code-sealing hooks', async () => {
	const config = readConfiguration('lightscaper');
	assert.equal(config.asar, true);
	assert.equal(config.npmRebuild, false);
	assert.equal(config.downloadAlternateFFmpeg, true);
	assert.equal(config.beforePack, './scripts/desktop-lightscaper-before-pack.mjs');
	assert.equal(config.afterPack, './scripts/desktop-lightscaper-after-pack.mjs');
	assert.equal(config.afterSign, './scripts/desktop-lightscaper-after-sign.mjs');
	assert.equal(config.afterAllArtifactBuild, './scripts/desktop-verify-release-artifacts.mjs');
	for (const hook of [beforePack, afterPack, afterSign, afterAllArtifactBuild]) assert.equal(typeof hook, 'function');
	const afterSignSource = await readFile(new URL('../scripts/desktop-lightscaper-after-sign.mjs', import.meta.url), 'utf8');
	assert.match(afterSignSource, /import verifySignature from '\.\/desktop-after-sign\.mjs';/u);
	assert.match(afterSignSource, /await verifySignature\(context\);\s*await verifyDesktopLightscaperPackageReceiptCurrentV1\(/u,
		'platform signature verification must settle before final native package receipt verification');
	const signIgnore = config.mac.signIgnore;
	assert.equal(signIgnore, '/Contents/Resources/runtime/photo-native/current-v1/');
	assert.equal(typeof signIgnore, 'string');
	assert.ok(typeof signIgnore === 'string');
	const sealedPhotoCode = new RegExp(signIgnore, 'u');
	assert.equal(sealedPhotoCode.test('/Lightscaper.app/Contents/Resources/runtime/photo-native/current-v1/mac-arm64/bin/lightscaper_photo_raw_current_v1'), true);
	for (const path of ['/Lightscaper.app/Contents/MacOS/Lightscaper', '/Lightscaper.app/Contents/Frameworks/Electron Framework.framework/Electron Framework',
		'/Lightscaper.app/Contents/Resources/renderer/assets/editor.js', '/Lightscaper.app/Contents/Resources/runtime/foreign/current-v1/helper']) {
		assert.equal(sealedPhotoCode.test(path), false, path);
	}
	assert.equal(config.publish, null);
});

test('Lightscaper explicit builder configuration refuses conflicting product selection', () => {
	assert.equal(readConfiguration(undefined).productName, 'Lightscaper');
	for (const value of ['', 'soundscaper', 'framescaper', 'Lightscaper', 'lightscaper ', 'unknown']) {
		const result = runNode(value);
		assert.notEqual(result.status, 0, `Lightscaper configuration accepted ${JSON.stringify(value)}.`);
		assert.match(result.stderr, /Lightscaper configuration requires SCAPE_PRODUCT=lightscaper/iu);
	}
});

function readConfiguration(productId: string | undefined): BuilderMetadata {
	const result = runNode(productId);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout) as BuilderMetadata;
}

function runNode(productId: string | undefined, source = SELECT_CONFIG) {
	const env: NodeJS.ProcessEnv = { ...process.env, SCAPE_MAC_SIGNING: 'false', SCAPE_WIN_SIGNING: 'none' };
	if (productId === undefined) delete env.SCAPE_PRODUCT;
	else env.SCAPE_PRODUCT = productId;
	return spawnSync(process.execPath, ['--eval', source], {
		cwd: ROOT, env, encoding: 'utf8', timeout: 10_000,
	});
}
