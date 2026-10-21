/* SPDX-License-Identifier: AGPL-3.0-only */

import { lightscaperPhotoRuntimeInventoryCurrentV1 as nativeInventory, verifyLightscaperPhotoRuntimeCurrentV1 as verifyNative } from './desktop-lightscaper-photo-native-current-v1.ts';
import { extractFile, listPackage, statFile, uncache } from '@electron/asar';
import { lstat, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { auditDesktopFfmpegAbsence } from './desktop-codec-policy.mjs';
import { validateDesktopPackageSpecificResources } from './desktop-package-format-layout.mjs';
import {
	assertLightscaperPackageEqualCurrentV1 as equal, captureLightscaperPackageFilesCurrentV1 as capture,
	lightscaperAbsoluteRootCurrentV1 as absolute, lightscaperPackageDigestCurrentV1 as digest,
	lightscaperRelativePathCurrentV1 as relativePath, readLightscaperPackageFileCurrentV1 as read,
	type LightscaperPackageFileCurrentV1,
} from './desktop-lightscaper-package-files-current-v1.ts';
import { verifyDesktopLightscaperRawRuntimeCurrentV1 } from './desktop-lightscaper-raw-runtime-current-v1.ts';
import { verifyDesktopLightscaperStageCurrentV1, normalizeLightscaperDesktopTargetCurrentV1,
	type DesktopLightscaperStageReceiptCurrentV1, type LightscaperDesktopTargetCurrentV1 } from './desktop-lightscaper-stage-current-v1.ts';

export const LIGHTSCAPER_PACKAGE_CONTENT_CURRENT_V1 = 'lightscaper-package-content-v1.json';
export interface LightscaperBuilderContextCurrentV1 {
	readonly electronPlatformName: string;
	readonly arch: string | number;
	readonly appOutDir: string;
	readonly packager: {
		readonly projectDir: string; readonly executableName: string;
		readonly config: { readonly directories?: { readonly app?: string } };
		readonly appInfo: { readonly productFilename: string; readonly version: string; readonly id: string };
		getResourcesDir(appOutDir: string): string;
	};
}
export interface LightscaperOwnedPackageReceiptCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'lightscaper-desktop-owned-package-v1';
	readonly status: 'owned-resource-closure-audited';
	readonly stage: DesktopLightscaperStageReceiptCurrentV1;
	readonly appAsar: LightscaperPackageFileCurrentV1;
}

export function lightscaperBuilderTargetCurrentV1(context: Readonly<LightscaperBuilderContextCurrentV1>): Readonly<LightscaperDesktopTargetCurrentV1> {
	const platforms: Readonly<Record<string, string>> = { linux: 'linux', darwin: 'mac', win32: 'win' };
	const arches: Readonly<Record<number, string>> = { 1: 'x64', 3: 'arm64' };
	return normalizeLightscaperDesktopTargetCurrentV1({ platform: platforms[context.electronPlatformName],
		arch: typeof context.arch === 'number' ? arches[context.arch] : context.arch });
}
/** The effective builder app directory selects the qualified stage, including private verification roots. */
export function lightscaperBuilderBuildRootCurrentV1(context: Readonly<LightscaperBuilderContextCurrentV1>): string {
	const configuredApp = context.packager.config.directories?.app;
	if (typeof configuredApp !== 'string' || !configuredApp || configuredApp.includes('\0')) {
		throw new TypeError('Lightscaper builder must select its staged app directory.');
	}
	const appRoot = resolve(absolute(context.packager.projectDir), configuredApp);
	if (basename(appRoot) !== 'app') throw new Error('Lightscaper builder app directory must be the stage app child.');
	return dirname(appRoot);
}

export async function verifyLightscaperBuilderStageCurrentV1(context: Readonly<LightscaperBuilderContextCurrentV1>): Promise<DesktopLightscaperStageReceiptCurrentV1> {
	const repositoryRoot = absolute(context.packager.projectDir), target = lightscaperBuilderTargetCurrentV1(context);
	const receipt = await verifyDesktopLightscaperStageCurrentV1({ repositoryRoot, buildRoot: lightscaperBuilderBuildRootCurrentV1(context), target });
	if (context.packager.appInfo.productFilename !== (target.platform === 'linux' ? 'lightscaper' : 'Lightscaper') || context.packager.appInfo.id !== 'org.lightscaper.desktop'
		|| context.packager.appInfo.version !== receipt.applicationVersion
		|| target.platform === 'linux' && context.packager.executableName !== 'lightscaper') {
		throw new Error('Lightscaper builder identity differs from the staged product.');
	}
	return receipt;
}

/** Compare actual ASAR members and owned resource bytes to the qualified stage. */
export async function verifyDesktopLightscaperPackagedCurrentV1({ repositoryRoot, buildRoot, resourcesRoot, target }: Readonly<{
	repositoryRoot: string; buildRoot: string; resourcesRoot: string; target: Readonly<LightscaperDesktopTargetCurrentV1>;
}>): Promise<LightscaperOwnedPackageReceiptCurrentV1> {
	const stage = await verifyDesktopLightscaperStageCurrentV1({ repositoryRoot, buildRoot, target });
	const root = absolute(resourcesRoot), metadata = await lstat(root);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Lightscaper packaged resource root must be a regular directory.');
	await assertResourceRoots(root, target);
	for (const scope of ['renderer', 'licenses'] as const) equal(await capture(join(root, scope)), stage.files[scope], `packaged ${scope}`);
	equal(await verifyDesktopLightscaperRawRuntimeCurrentV1({ runtimeRoot: join(root, 'runtime') }), stage.rawRuntime, 'packaged RAW receipt');
	if (stage.nativePhotoRuntime) await verifyNative(join(root, 'runtime'), stage.nativePhotoRuntime);
	equal(await capture(join(root, 'runtime')), [...stage.rawRuntime.files, ...nativeInventory(stage.nativePhotoRuntime)].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), 'packaged RAW/native inventory');
	const appAsar = await verifyAsar(root, stage.files.app);
	await auditDesktopFfmpegAbsence({ root, label: 'Lightscaper packaged resources' });
	return Object.freeze({ schemaVersion: 1, kind: 'lightscaper-desktop-owned-package-v1', status: 'owned-resource-closure-audited', stage, appAsar });
}

export function lightscaperBuilderResourcesRootCurrentV1(context: Readonly<LightscaperBuilderContextCurrentV1>): string {
	const output = absolute(context.appOutDir), target = lightscaperBuilderTargetCurrentV1(context);
	const expected = target.platform === 'mac' ? join(output, 'Lightscaper.app/Contents/Resources') : join(output, 'resources');
	if (resolve(context.packager.getResourcesDir(output)) !== expected) throw new Error('Lightscaper builder resource root does not match its platform.');
	return expected;
}

export async function writeDesktopLightscaperPackageReceiptCurrentV1(resourcesRoot: string,
	receipt: Readonly<LightscaperOwnedPackageReceiptCurrentV1>): Promise<void> {
	const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
	if (bytes.length > 16 * 1024 ** 2) throw new RangeError('Lightscaper package receipt exceeds its bound.');
	await writeFile(join(absolute(resourcesRoot), LIGHTSCAPER_PACKAGE_CONTENT_CURRENT_V1), bytes, { flag: 'wx' });
}
export async function verifyDesktopLightscaperPackageReceiptCurrentV1(options: Readonly<{
	repositoryRoot: string; buildRoot: string; resourcesRoot: string; target: Readonly<LightscaperDesktopTargetCurrentV1>;
}>): Promise<LightscaperOwnedPackageReceiptCurrentV1> {
	const bytes = await read(options.resourcesRoot, LIGHTSCAPER_PACKAGE_CONTENT_CURRENT_V1, 16 * 1024 ** 2);
	const receipt: unknown = JSON.parse(bytes.toString('utf8'));
	const actual = await verifyDesktopLightscaperPackagedCurrentV1(options);
	equal(receipt, actual, 'embedded owned-resource receipt');
	return actual;
}

async function verifyAsar(root: string, expected: readonly LightscaperPackageFileCurrentV1[]): Promise<LightscaperPackageFileCurrentV1> {
	const archive = join(root, 'app.asar'), before = await read(root, 'app.asar', 64 * 1024 ** 2);
	const sha256 = digest(before), allowed = new Map(expected.map(file => [file.path, file]));
	const directories = new Set<string>();
	for (const file of allowed.keys()) {
		const segments = file.split('/');
		for (let length = 1; length < segments.length; length++) directories.add(segments.slice(0, length).join('/'));
	}
	const observed = new Set<string>(), seen = new Set<string>();
	uncache(archive);
	try {
		const names = listPackage(archive, { isPack: false });
		if (names.length > expected.length + directories.size) throw new Error('Lightscaper ASAR has extra members.');
		for (const entry of names) {
			const name = relativePath(entry.replace(/^[/\\]/u, '').replaceAll('\\', '/'));
			if (seen.has(name.toLowerCase())) throw new Error('Lightscaper ASAR has duplicate or aliased members.');
			seen.add(name.toLowerCase());
			const member = statFile(archive, name, false);
			if ('link' in member || member.unpacked === true) throw new Error('Lightscaper ASAR may not redirect application bytes.');
			if ('files' in member) {
				if (!directories.has(name)) throw new Error('Lightscaper ASAR has an unexpected directory.');
				continue;
			}
			const pin = allowed.get(name);
			if (!pin || member.size !== pin.byteLength) throw new Error('Lightscaper ASAR has missing, extra or resized application content.');
			const bytes = extractFile(archive, name, false);
			if (bytes.length !== pin.byteLength || digest(bytes) !== pin.sha256) throw new Error('Lightscaper ASAR application content changed.');
			observed.add(name);
		}
		if (observed.size !== allowed.size) throw new Error('Lightscaper ASAR is missing application content.');
		equal(digest(await read(root, 'app.asar', 64 * 1024 ** 2)), sha256, 'ASAR archive readback');
		return Object.freeze({ path: 'app.asar', byteLength: before.length, sha256 });
	} finally { uncache(archive); }
}

/** Electron's existing localization/icons stay outside application capability ownership. */
async function assertResourceRoots(root: string, target: Readonly<LightscaperDesktopTargetCurrentV1>): Promise<void> {
	const owned = new Set(['app.asar', 'renderer', 'runtime', 'licenses', LIGHTSCAPER_PACKAGE_CONTENT_CURRENT_V1]);
	for (const child of await readdir(root, { withFileTypes: true })) {
		if (owned.has(child.name)) continue;
		if (target.platform === 'linux' && child.name === 'apparmor-profile') {
			await validateDesktopPackageSpecificResources({ packageFormat: '.deb', productId: 'lightscaper',
				resourcesRoot: root, targetId: `linux-${target.arch}` });
			continue;
		}
		if (target.platform === 'mac' && child.isFile() && ['electron.icns', 'Lightscaper.icns', 'icon.icns'].includes(child.name)) continue;
		if (target.platform === 'mac' && child.isDirectory() && /^[A-Za-z0-9_-]{1,32}\.lproj$/u.test(child.name)) {
			const entries = await capture(join(root, child.name));
			if (entries.some(file => !/\.(?:pak|strings|nib)$/u.test(file.path))) throw new Error('Lightscaper Electron localization has unexpected executable content.');
			continue;
		}
		const kind = child.isSymbolicLink() ? 'symlink' : child.isDirectory() ? 'directory' : child.isFile() ? 'file' : 'other';
		throw new Error(`Lightscaper packaged resources contain an unexpected application tree (${target.platform}-${target.arch}): ${JSON.stringify({ name: child.name, kind })}`);
	}
}
