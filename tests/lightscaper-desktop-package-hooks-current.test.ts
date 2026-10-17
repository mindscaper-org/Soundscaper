/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createPackage } from '@electron/asar';
import { FuseVersion, FuseV1Options, type FuseConfig } from '@electron/fuses';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveProductDesktopMetadata } from '../scripts/lib/product-release-lines.mjs';
import { stageDesktopLightscaperRawRuntimeCurrentV1 } from '../scripts/lib/desktop-lightscaper-raw-runtime-current-v1.ts';
import { captureDesktopLightscaperStageCurrentV1, normalizeLightscaperStageReceiptCurrentV1,
	verifyDesktopLightscaperStageCurrentV1 } from '../scripts/lib/desktop-lightscaper-stage-current-v1.ts';
import { lightscaperRelativePathCurrentV1 } from '../scripts/lib/desktop-lightscaper-package-files-current-v1.ts';
import { lightscaperBuilderBuildRootCurrentV1, lightscaperBuilderTargetCurrentV1, verifyDesktopLightscaperPackagedCurrentV1,
	verifyDesktopLightscaperPackageReceiptCurrentV1, LIGHTSCAPER_PACKAGE_CONTENT_CURRENT_V1,
	type LightscaperBuilderContextCurrentV1 } from '../scripts/lib/desktop-lightscaper-package-current-v1.ts';
import { hardenDesktopElectronFusesCurrentV1 } from '../scripts/lib/desktop-electron-fuses-current-v1.ts';
import beforePack from '../scripts/desktop-lightscaper-before-pack.mjs';
import afterPack from '../scripts/desktop-lightscaper-after-pack.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TARGET = { platform: 'linux', arch: 'x64' } as const;
const REVISION = 'a'.repeat(40);

test('Lightscaper hook receipt binds actual app, renderer, RAW and complete license closure', async context => {
	const fixture = await makeFixture(context);
	const receipt = await verifyDesktopLightscaperStageCurrentV1(fixture);
	assert.equal(receipt.productId, 'lightscaper');
	assert.equal(receipt.releaseChannel, 'deferred');
	assert.equal(receipt.rawRuntime.files.length, 33);
	assert.deepEqual(receipt.files.app.map(file => file.path), [
		'desktop/main.mjs', 'desktop/preload.cjs', 'desktop/product.json', 'package.json',
	]);
	await beforePack(fixture.builder);
	const packaged = await verifyDesktopLightscaperPackagedCurrentV1(fixture);
	assert.equal(packaged.appAsar.path, 'app.asar');
	assert.equal(packaged.status, 'owned-resource-closure-audited');
	assert.deepEqual(packaged.stage, receipt);
});

test('Lightscaper hooks authenticate a private stage selected by the effective builder app directory', async context => {
	const fixture = await makeFixture(context, true);
	assert.equal(lightscaperBuilderBuildRootCurrentV1(fixture.builder), fixture.buildRoot);
	await beforePack(fixture.builder);
	const relativeBuilder = { ...fixture.builder, packager: { ...fixture.builder.packager,
		config: { directories: { app: relative(fixture.repositoryRoot, join(fixture.buildRoot, 'app')) } } } };
	assert.equal(lightscaperBuilderBuildRootCurrentV1(relativeBuilder), fixture.buildRoot);
	await beforePack(relativeBuilder);
	await afterPack(relativeBuilder, { verifyElectronAlternateFfmpeg: async () => {}, flipFuses: async () => {} });
	assert.equal((await verifyDesktopLightscaperPackageReceiptCurrentV1(fixture)).stage.sourceRevision, REVISION);
	for (const app of [undefined, '', '.', '../wrong-child', 'private/app\0']) {
		assert.throws(() => lightscaperBuilderBuildRootCurrentV1({ ...fixture.builder,
			packager: { ...fixture.builder.packager, config: { directories: { app } } } }));
	}
});

test('Lightscaper stage refuses changed, missing and extra owned members and license loss', async context => {
	const fixture = await makeFixture(context);
	for (const name of ['app/desktop/main.mjs', 'renderer/assets/editor.js', 'licenses/THIRD_PARTY_LICENSES.md']) {
		const path = join(fixture.buildRoot, name), original = await readFile(path);
		await writeFile(path, Buffer.alloc(original.length, 88));
		await assert.rejects(verifyDesktopLightscaperStageCurrentV1(fixture));
		await writeFile(path, original);
	}
	for (const name of ['app/desktop/foreign.mjs', 'renderer/assets/extra.js', 'runtime/helper.exe', 'licenses/foreign.txt']) {
		const path = join(fixture.buildRoot, name); await writeFile(path, 'foreign application bytes');
		await assert.rejects(verifyDesktopLightscaperStageCurrentV1(fixture)); await rm(path);
	}
	const missing = join(fixture.buildRoot, 'renderer/assets/editor.js'), original = await readFile(missing);
	await rm(missing); await assert.rejects(verifyDesktopLightscaperStageCurrentV1(fixture)); await writeFile(missing, original);
	await verifyDesktopLightscaperStageCurrentV1(fixture);
});

test('Lightscaper stage metadata refuses wrong product, version, target, extra authority and escaped paths', async context => {
	const fixture = await makeFixture(context), receipt = await verifyDesktopLightscaperStageCurrentV1(fixture);
	for (const value of [
		{ ...receipt, productId: 'soundscaper' }, { ...receipt, applicationVersion: '1.0.0' },
		{ ...receipt, releaseChannel: 'candidate' }, { ...receipt, sourceRevision: null },
		{ ...receipt, nativeServices: {} }, { ...receipt, target: { platform: 'mac', arch: 'x64' } },
		{ ...receipt, files: { ...receipt.files, app: [{ path: '../escape', byteLength: 1, sha256: 'b'.repeat(64) }] } },
	]) assert.throws(() => normalizeLightscaperStageReceiptCurrentV1(value));
	for (const path of ['../escape', '/absolute', 'C:/escape', 'a\\escape', 'a/./escape', 'a//escape', 'a\0escape']) {
		assert.throws(() => lightscaperRelativePathCurrentV1(path));
	}
	await assert.rejects(verifyDesktopLightscaperStageCurrentV1({ ...fixture, target: { platform: 'win', arch: 'x64' } }));
	await assert.rejects(beforePack({ ...fixture.builder, packager: { ...fixture.builder.packager,
		appInfo: { ...fixture.builder.packager.appInfo, productFilename: 'Soundscaper' } } }));
	assert.deepEqual(lightscaperBuilderTargetCurrentV1({ ...fixture.builder, electronPlatformName: 'darwin', arch: 3 }), { platform: 'mac', arch: 'arm64' });
	assert.throws(() => lightscaperBuilderTargetCurrentV1({ ...fixture.builder, arch: 0 }));
});

test('Lightscaper packaged resources refuse changed, missing, extra and linked content independently of stage', async context => {
	const fixture = await makeFixture(context);
	for (const name of ['renderer/assets/editor.js', 'licenses/THIRD_PARTY_LICENSES.md', 'runtime/libraw/0.22.2/libraw.wasm']) {
		const path = join(fixture.resourcesRoot, name), bytes = await readFile(path);
		await writeFile(path, Buffer.alloc(bytes.length, 88));
		await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture)); await writeFile(path, bytes);
	}
	for (const name of ['renderer/extra.js', 'runtime/helper.exe', 'licenses/extra.txt', 'helper.exe']) {
		const path = join(fixture.resourcesRoot, name); await writeFile(path, 'unreviewed helper');
		await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture)); await rm(path);
	}
	const linked = join(fixture.resourcesRoot, 'renderer/assets/editor.js'), bytes = await readFile(linked);
	await rm(linked); await symlink(join(fixture.buildRoot, 'renderer/assets/editor.js'), linked);
	await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture)); await rm(linked); await writeFile(linked, bytes);
	await verifyDesktopLightscaperPackagedCurrentV1(fixture);
});

test('Lightscaper admits only authenticated Debian AppArmor metadata outside owned resources', async context => {
	const fixture = await makeFixture(context), path = join(fixture.resourcesRoot, 'apparmor-profile');
	const profile = [
		'abi <abi/4.0>,', 'include <tunables/global>', '',
		'profile "lightscaper" "/opt/Lightscaper/lightscaper" flags=(unconfined) {',
		'  userns,', '', '  # Site-specific additions and overrides. See local/README for details.',
		'  include if exists <local/lightscaper>', '}',
	].join('\n');
	await writeFile(path, profile, { mode: 0o644 });
	await verifyDesktopLightscaperPackagedCurrentV1(fixture);
	await writeFile(path, profile.replace('/opt/Lightscaper/', '/opt/Foreign/'));
	await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture), /AppArmor/u);
	await writeFile(path, profile); await chmod(path, 0o755);
	await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture), /AppArmor/u);
	await chmod(path, 0o644); await rm(path);
	const source = join(fixture.repositoryRoot, 'apparmor-profile'); await writeFile(source, profile);
	await symlink(source, path);
	await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture), /AppArmor/u);
	await rm(path); await writeFile(path, profile, { mode: 0o644 });
	await verifyDesktopLightscaperPackagedCurrentV1(fixture);
});

test('Lightscaper ASAR closes application member inventory and rejects redirected or changed members', async context => {
	const fixture = await makeFixture(context), asar = join(fixture.resourcesRoot, 'app.asar');
	const path = join(fixture.buildRoot, 'app/desktop/main.mjs'), original = await readFile(path);
	await writeFile(path, 'export const replaced = true;'); await createPackage(join(fixture.buildRoot, 'app'), asar); await writeFile(path, original);
	await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture), /ASAR/u);
	const extra = join(fixture.buildRoot, 'app/desktop/helper.mjs'); await writeFile(extra, 'export {};');
	await createPackage(join(fixture.buildRoot, 'app'), asar); await rm(extra);
	await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture), /ASAR/u);
	await rm(path); await symlink('preload.cjs', path); await createPackage(join(fixture.buildRoot, 'app'), asar);
	await rm(path); await writeFile(path, original);
	await assert.rejects(verifyDesktopLightscaperPackagedCurrentV1(fixture), /ASAR/u);
});

test('Lightscaper afterPack authenticates before hardening and embeds a tamper-evident owned receipt', async context => {
	const fixture = await makeFixture(context), events: string[] = [];
	await assert.rejects(afterPack(fixture.builder, {
		verifyElectronAlternateFfmpeg: async () => { events.push('alternate-failed'); throw new Error('wrong alternate library'); },
		flipFuses: async () => { events.push('fuses'); },
	}), /alternate library/u);
	assert.deepEqual(events, ['alternate-failed']);
	await afterPack(fixture.builder, {
		verifyElectronAlternateFfmpeg: async () => { events.push('alternate-verified'); },
		flipFuses: async () => { events.push('fuses'); },
	});
	assert.deepEqual(events, ['alternate-failed', 'alternate-verified', 'fuses']);
	const actual = await verifyDesktopLightscaperPackageReceiptCurrentV1(fixture);
	assert.equal(actual.stage.sourceRevision, REVISION);
	const path = join(fixture.resourcesRoot, LIGHTSCAPER_PACKAGE_CONTENT_CURRENT_V1);
	await writeFile(path, JSON.stringify({ ...actual, status: 'fake-success' }));
	await assert.rejects(verifyDesktopLightscaperPackageReceiptCurrentV1(fixture), /receipt/u);
});

test('Lightscaper shares the complete production fuse policy on all maintained packaging platforms', async () => {
	for (const [platform, arch, suffix] of [['linux', 1, 'lightscaper'], ['linux', 3, 'lightscaper'],
		['win32', 1, 'Lightscaper.exe'], ['win32', 3, 'Lightscaper.exe'], ['darwin', 3, 'Lightscaper.app']] as const) {
		let recorded: FuseConfig | undefined;
		await hardenDesktopElectronFusesCurrentV1({ electronPlatformName: platform, appOutDir: '/package-output',
			packager: { executableName: 'lightscaper', appInfo: { productFilename: 'Lightscaper' } } }, async (path, options) => {
			assert.equal(path, join('/package-output', suffix)); recorded = options;
		});
		assert.deepEqual(recorded, { version: FuseVersion.V1, strictlyRequireAllFuses: true,
			[FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, [FuseV1Options.OnlyLoadAppFromAsar]: true,
			[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false, [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
			[FuseV1Options.WasmTrapHandlers]: true });
		assert.ok([1, 3].includes(arch));
	}
});

async function makeFixture(context: TestContext, privateStage = false) {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'lightscaper-package-hook-'));
	context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
	const repositoryRoot = privateStage ? join(fixtureRoot, 'source') : fixtureRoot;
	const buildRoot = privateStage ? join(fixtureRoot, 'private stage') : join(repositoryRoot, '.desktop-build');
	const resourcesRoot = join(repositoryRoot, 'release/resources');
	const metadata = resolveProductDesktopMetadata('lightscaper');
	for (const directory of ['app/desktop', 'renderer/assets', 'runtime', 'licenses/LICENSES']) await mkdir(join(buildRoot, directory), { recursive: true });
	await mkdir(join(repositoryRoot, 'config'), { recursive: true });
	await cp(join(ROOT, 'config/product-release-lines.json'), join(repositoryRoot, 'config/product-release-lines.json'));
	for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.md']) await cp(join(ROOT, name), join(repositoryRoot, name));
	await cp(join(ROOT, 'LICENSES'), join(repositoryRoot, 'LICENSES'), { recursive: true });
	await cp(join(ROOT, 'LICENSES'), join(buildRoot, 'licenses/LICENSES'), { recursive: true });
	await cp(join(ROOT, 'LICENSE'), join(buildRoot, 'licenses/Soundscaper-AGPL-3.0.txt'));
	await cp(join(ROOT, 'THIRD_PARTY_LICENSES.md'), join(buildRoot, 'licenses/THIRD_PARTY_LICENSES.md'));
	await writeFile(join(buildRoot, 'app/desktop/main.mjs'), 'export const managed = true;');
	await writeFile(join(buildRoot, 'app/desktop/preload.cjs'), 'module.exports = {};');
	await writeFile(join(buildRoot, 'app/desktop/product.json'), JSON.stringify(metadata));
	await writeFile(join(buildRoot, 'app/package.json'), JSON.stringify({ name: 'lightscaper-desktop', productName: 'Lightscaper',
		version: metadata.applicationVersion, main: 'desktop/main.mjs', type: 'module', license: 'AGPL-3.0-only' }));
	await writeFile(join(buildRoot, 'renderer/index.html'), '<title>Lightscaper</title>');
	await writeFile(join(buildRoot, 'renderer/assets/editor.js'), 'export const photo = true;');
	await stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot: ROOT, runtimeRoot: join(buildRoot, 'runtime') });
	const stage = await captureDesktopLightscaperStageCurrentV1({ repositoryRoot, buildRoot, productMetadata: metadata, target: TARGET, sourceRevision: REVISION });
	await writeFile(join(buildRoot, 'stage-manifest.json'), JSON.stringify(stage));
	await mkdir(resourcesRoot, { recursive: true });
	for (const scope of ['renderer', 'runtime', 'licenses']) await cp(join(buildRoot, scope), join(resourcesRoot, scope), { recursive: true });
	await createPackage(join(buildRoot, 'app'), join(resourcesRoot, 'app.asar'));
	const builder: LightscaperBuilderContextCurrentV1 = { electronPlatformName: 'linux', arch: 1, appOutDir: dirname(resourcesRoot),
		packager: { projectDir: repositoryRoot, executableName: 'lightscaper',
			config: { directories: { app: privateStage ? join(buildRoot, 'app') : '.desktop-build/app' } },
			appInfo: { productFilename: 'lightscaper', version: metadata.applicationVersion, id: 'org.lightscaper.desktop' },
			getResourcesDir: () => resourcesRoot } };
	return { repositoryRoot, buildRoot, resourcesRoot, target: TARGET, builder };
}
