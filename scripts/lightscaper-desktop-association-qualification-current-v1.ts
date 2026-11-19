#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readLightscaperDesktopNativeCiTargetCurrentV1 } from './lib/lightscaper-desktop-native-ci-plan-current-v1.ts';
import { createLightscaperAssociationProcessOwnerCurrentV1 as processOwner, associationAbsoluteCurrentV1 as absolute,
	associationFileCurrentV1 as file, associationReadCurrentV1 as read } from './lib/lightscaper-desktop-association-evidence-current-v1.ts';
import { createLightscaperAssociationInstallerCurrentV1 as installer, selectLightscaperAssociationArtifactCurrentV1 as artifact } from './lib/lightscaper-desktop-association-install-current-v1.ts';
import { createLightscaperLinuxAssociationEnvironmentCurrentV1 } from './lib/lightscaper-desktop-association-linux-current-v1.ts';
import { createLightscaperNativeAssociationSmokeCurrentV1 } from './lib/lightscaper-desktop-association-native-current-v1.ts';
import { verifyDesktopLightscaperPackageReceiptCurrentV1 } from './lib/desktop-lightscaper-package-current-v1.ts';

export function readLightscaperAssociationQualificationOptionsCurrentV1(args: readonly string[]) {
	const names = ['--target', '--source-revision', '--npm-cli', '--work-root', '--evidence-root', '--association-helper', '--association-helper-sha256'];
	const values = new Map<string, string>();
	for (let at = 0; at < args.length; at++) {
		const name = args[at]!, value = args[++at];
		if (!names.includes(name) || values.has(name) || !value || value.includes('\0')) throw new TypeError('Registered association qualification requires fixed unique option/value pairs.');
		values.set(name, value);
	}
	for (const name of names) if (!values.has(name)) throw new TypeError('Missing registered association qualification option: ' + name);
	const target = readLightscaperDesktopNativeCiTargetCurrentV1(values.get('--target'));
	const sourceRevision = values.get('--source-revision')!, helperSha256 = values.get('--association-helper-sha256')!;
	if (!/^[a-f0-9]{40}$/u.test(sourceRevision) || !/^[a-f0-9]{64}$/u.test(helperSha256)) throw new TypeError('Association source/helper SHA must be complete lowercase hexadecimal.');
	return Object.freeze({ target, sourceRevision, helperSha256, helperPath: absolute(values.get('--association-helper')!),
		npmCli: absolute(values.get('--npm-cli')!), workRoot: absolute(values.get('--work-root')!), evidenceRoot: absolute(values.get('--evidence-root')!) });
}

/** Ephemeral target-native installer + real default OS dispatch to a warmed
 * primary. No production IPC, direct archive argv or injected renderer File. */
export async function runLightscaperDesktopAssociationQualificationCurrentV1(args: readonly string[]): Promise<string> {
	const options = readLightscaperAssociationQualificationOptionsCurrentV1(args), repositoryRoot = await realpath(process.cwd());
	assert.equal(process.version, 'v26.5.0'); assert.equal(process.arch, options.target.arch);
	assert.equal(process.platform, options.target.platform === 'mac' ? 'darwin' : options.target.platform === 'win' ? 'win32' : 'linux');
	assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
	const git = (command: readonly string[]): string => execFileSync('git', [...command], { cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 }).trim();
	assert.equal(git(['rev-parse', 'HEAD']), options.sourceRevision); assert.equal(git(['status', '--porcelain']), '');
	assert.ok(!overlap(options.workRoot, repositoryRoot) && !overlap(options.evidenceRoot, repositoryRoot) && !overlap(options.workRoot, options.evidenceRoot));
	assert.equal(await realpath(dirname(options.workRoot)), dirname(options.workRoot)); assert.equal(await realpath(dirname(options.evidenceRoot)), dirname(options.evidenceRoot));
	assert.equal(await realpath(options.npmCli), options.npmCli);
	const npmPackage: unknown = JSON.parse((await read(join(dirname(options.npmCli), '../package.json'), 1024 * 1024)).toString('utf8'));
	assert.ok(npmPackage && typeof npmPackage === 'object' && 'version' in npmPackage && npmPackage.version === '12.0.1');
	const helper = await file(options.helperPath, 64 * 1024 ** 2); assert.equal(helper.sha256, options.helperSha256);
	await mkdir(options.evidenceRoot, { mode: 0o700 }); await mkdir(options.workRoot, { mode: 0o700 });
	const owner = processOwner({ evidenceRoot: options.evidenceRoot, windowsJobHelper: process.env.LIGHTSCAPER_WINDOWS_JOB_HELPER,
		windowsJobHelperSha256: process.env.LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256 });
	const changes = new Map<string, string | undefined>();
	function set(name: string, value: string | undefined): void { if (!changes.has(name)) changes.set(name, process.env[name]); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
	async function receipt(name: string, value: unknown): Promise<string> {
		const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); if (bytes.length > 16 * 1024 ** 2) throw new Error('Association receipt exceeded its bounded diagnostic budget.');
		const path = join(options.evidenceRoot, name); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); return path;
	}
	let installation: Awaited<ReturnType<typeof installer>> | undefined;
	let linux: Awaited<ReturnType<typeof createLightscaperLinuxAssociationEnvironmentCurrentV1>> | undefined;
	let scenario: ReturnType<typeof createLightscaperNativeAssociationSmokeCurrentV1> | undefined, complete = false;
	let uninstall: unknown, installReceipt: unknown, packageReceipt: unknown, smoke: unknown;
	try {
		set('SCAPE_PRODUCT', 'lightscaper'); set('SOUNDSCAPER_DESKTOP_TARGET_PLATFORM', options.target.platform); set('SOUNDSCAPER_DESKTOP_TARGET_ARCH', options.target.arch);
		set('SCAPE_DESKTOP_BUILD_ROOT', join(options.workRoot, 'stage')); set('LIGHTSCAPER_PHOTO_NATIVE_BUILD_RESULT', undefined);
		set('SCAPE_MAC_SIGNING', 'false'); set('SCAPE_WIN_SIGNING', 'none'); set('CSC_IDENTITY_AUTO_DISCOVERY', 'false');
		for (const name of ['TMPDIR', 'TMP', 'TEMP']) set(name, options.workRoot);
		set('LIGHTSCAPER_CI_SOURCE_ROOT', repositoryRoot); set('LIGHTSCAPER_CI_NPM_CLI', options.npmCli);
		const entry = join(options.workRoot, 'public-package-entry.cjs'), output = join(options.workRoot, 'package');
		await writeFile(entry, 'process.chdir(process.env.LIGHTSCAPER_CI_SOURCE_ROOT);\nprocess.argv[1]=process.env.LIGHTSCAPER_CI_NPM_CLI;\nrequire(process.argv[1]);\n', { flag: 'wx', mode: 0o600 });
		const format = options.target.platform === 'linux' ? 'deb' : options.target.platform === 'mac' ? 'dmg' : 'nsis';
		await owner.run(process.execPath, [entry, 'run', 'desktop:dist', '--', '--' + options.target.platform, format, '--' + options.target.arch,
			'--publish', 'never', '--config.directories.output=' + output], { deadlineMs: 210_000 });
		installation = await installer({ target: options.target, artifactPath: await artifact(output, options.target.platform), workRoot: options.workRoot, processOwner: owner, registryScriptPath: join(repositoryRoot, 'scripts/lib/lightscaper-desktop-association-registry-current-v1.ps1'), registryRetireScriptPath: join(repositoryRoot, 'scripts/lib/lightscaper-desktop-association-registry-retire-current-v1.ps1') });
		installReceipt = await installation.install();
		const verifiedPackage = await verifyDesktopLightscaperPackageReceiptCurrentV1({ repositoryRoot, buildRoot: join(options.workRoot, 'stage'), resourcesRoot: installation.resourcesRoot,
			target: { platform: options.target.platform, arch: options.target.arch } });
		packageReceipt = verifiedPackage; assert.equal(verifiedPackage.stage.sourceRevision, options.sourceRevision); assert.equal(verifiedPackage.stage.nativePhotoRuntime, undefined);
		if (options.target.platform === 'linux') linux = await createLightscaperLinuxAssociationEnvironmentCurrentV1({ ownerRoot: options.workRoot, executablePath: installation.executablePath, processOwner: owner });
		const profilePath = linux?.profilePath ?? (options.target.platform === 'mac' ? join(homedir(), 'Library/Application Support/Lightscaper') : join(absolute(process.env.APPDATA ?? ''), 'Lightscaper'));
		scenario = createLightscaperNativeAssociationSmokeCurrentV1({ target: options.target.target, sourceRevision: options.sourceRevision, executablePath: installation.executablePath,
			helperPath: options.helperPath, helperSha256: options.helperSha256, evidenceRoot: options.evidenceRoot, processOwner: owner,
			bundlePath: installation.bundlePath, desktopFile: linux?.desktopFile, profilePath, runtimeRoot: join(installation.resourcesRoot, 'runtime'), outputRoot: options.evidenceRoot,
			linuxRegistration: linux?.register, installerRegistration: { kind: 'actual-per-user-native-installer', install: installReceipt },
			windowsJobHelper: process.env.LIGHTSCAPER_WINDOWS_JOB_HELPER, windowsJobHelperSha256: process.env.LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256 });
		const smokePath = await scenario.run();
		smoke = JSON.parse((await read(smokePath, 8 * 1024 ** 2)).toString('utf8')) as unknown;
		assert.ok(smoke && typeof smoke === 'object' && 'status' in smoke && smoke.status === 'passed' && 'profileRemoved' in smoke && smoke.profileRemoved === true);
		assert.equal(scenario.readersRetired && scenario.registrationRetired && owner.readersRetired, true);
		uninstall = await installation.uninstall(true); await linux?.close(true);
		assert.equal(git(['rev-parse', 'HEAD']), options.sourceRevision); assert.equal(git(['status', '--porcelain']), '');
		await rm(options.workRoot, { recursive: true }); complete = true;
		return await receipt('registered-association-qualification.json', { schemaVersion: 1, kind: 'lightscaper-target-native-registered-association-current-v1', status: 'passed',
			target: options.target.target, sourceRevision: options.sourceRevision, helper, install: installReceipt, package: packageReceipt, smoke,
			uninstall, workRemoved: true, warmPrimaryDispatch: true, coldOsLaunchClaimed: false, profileRemoved: true, allConsumersRetired: true });
	} catch (primary) {
		let cleanupFailure: unknown;
		if ((!scenario || scenario.readersRetired && scenario.registrationRetired) && owner.readersRetired) {
			try { if (installation) uninstall = await installation.uninstall(true); await linux?.close(true); }
			catch (error) { cleanupFailure = error; }
		}
		await receipt('registered-association-failure.json', { schemaVersion: 1, status: 'failed', sourceRevision: options.sourceRevision, target: options.target.target,
			message: primary instanceof Error ? primary.message : 'Unknown failure', cleanupMessage: cleanupFailure instanceof Error ? cleanupFailure.message : cleanupFailure === undefined ? null : 'Unknown cleanup failure',
			appAndNativeReadersRetired: scenario?.readersRetired ?? true, registrationRetired: scenario?.registrationRetired ?? true, utilityReadersRetired: owner.readersRetired, workRetained: !complete, install: installReceipt, package: packageReceipt, smoke, uninstall });
		if (cleanupFailure !== undefined) throw new AggregateError([primary, cleanupFailure], 'Registered association qualification and actual rollback failed.', { cause: primary });
		throw primary;
	} finally {
		linux?.restoreEnvironment(); for (const [name, value] of changes) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
	}
}
function overlap(a: string, b: string): boolean {
	const inside = (parent: string, child: string): boolean => { const path = relative(parent, child); return !path || !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep); };
	return inside(a, b) || inside(b, a);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	void runLightscaperDesktopAssociationQualificationCurrentV1(process.argv.slice(2)).then(path => { console.log(`Registered Lightscaper association passed: ${path}`); }, (error: unknown) => { console.error(error); process.exitCode = 1; });
}
