#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLightscaperDesktopManagedSmokeCurrentV1 } from './lightscaper-desktop-managed-smoke-current-v1.ts';
import { createLightscaperDesktopNativeCiPlanCurrentV1, type LightscaperDesktopNativeCiPhaseCurrentV1 } from './lib/lightscaper-desktop-native-ci-plan-current-v1.ts';
import { verifyLightscaperPhotoNativeBuildResultCurrentV1 } from './lib/lightscaper-photo-native-build-current-v1.ts';
import { verifyDesktopLightscaperPackageReceiptCurrentV1 } from './lib/desktop-lightscaper-package-current-v1.ts';
import { launchLightscaperManagedSmokeProcessCurrentV1 } from './lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';
import { admitLightscaperWindowsJobHelperCurrentV1, launchLightscaperWindowsJobProcessCurrentV1 } from './lib/lightscaper-windows-job-driver-current-v1.ts';

const MAXIMUM_RECEIPT = 16 * 1024 * 1024, MAXIMUM_ARTIFACT = 64 * 1024 * 1024;
type QualificationWorkRemover = (path: string, options: Readonly<{
	recursive: true; force: false; maxRetries: number; retryDelay: number;
}>) => Promise<void>;

/** Only called after both package phases and their actual process owners joined. */
export async function retireLightscaperDesktopNativeWorkCurrentV1(
	workRoot: string, remove: QualificationWorkRemover = rm,
): Promise<void> {
	await remove(workRoot, { recursive: true, force: false, maxRetries: 10, retryDelay: 100 });
}

/** Internal qualification, never a release publisher. Packaging uses the public
 * command. Only successful actual app/group/Job retirement permits work removal. */
export async function runLightscaperDesktopNativeQualificationCurrentV1(args: readonly string[]): Promise<string> {
	const options = readOptions(args), repositoryRoot = await realpath(process.cwd());
	const nativeBuildResultRoot = await realpath(options.nativeResult);
	const workRoot = join(await realpath(dirname(options.workRoot)), basename(options.workRoot));
	const evidenceRoot = join(await realpath(dirname(options.evidenceRoot)), basename(options.evidenceRoot));
	const plan = createLightscaperDesktopNativeCiPlanCurrentV1({ target: options.target, sourceRevision: options.sourceRevision, workRoot, nativeBuildResultRoot });
	assert.equal(process.version, 'v26.5.0'); assert.equal(process.arch, plan.target.arch);
	assert.equal(process.platform, plan.target.platform === 'mac' ? 'darwin' : plan.target.platform === 'win' ? 'win32' : 'linux');
	assert.equal(await realpath(dirname(workRoot)), dirname(workRoot)); assert.equal(await realpath(dirname(evidenceRoot)), dirname(evidenceRoot));
	assert.ok(!overlaps(workRoot, evidenceRoot), 'Evidence must survive independent work retirement.');
	assert.ok(!overlaps(repositoryRoot, workRoot) && !overlaps(repositoryRoot, evidenceRoot), 'Qualification paths must be outside source.');
	assert.ok(!overlaps(nativeBuildResultRoot, evidenceRoot), 'Input artifacts must not be overwritten by evidence.');
	const npmCli = await realpath(options.npmCli), npmStat = await lstat(npmCli);
	assert.ok(npmStat.isFile() && !npmStat.isSymbolicLink());
	const npmPackage = JSON.parse((await boundedRead(join(dirname(npmCli), '..', 'package.json'), 1024 * 1024)).toString('utf8')) as { version?: unknown };
	assert.equal(npmPackage.version, '12.0.1');
	const native = await verifyLightscaperPhotoNativeBuildResultCurrentV1({ repositoryRoot, buildResultRoot: nativeBuildResultRoot, target: plan.target.target });
	assert.equal(native.sourceRevision, plan.sourceRevision, 'Native artifact must name this exact production commit.');
	const helperPath = process.env.LIGHTSCAPER_WINDOWS_JOB_HELPER, helperSha256 = process.env.LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256;
	const windows = process.platform === 'win32' ? await admitLightscaperWindowsJobHelperCurrentV1({ helperPath: helperPath ?? '', helperSha256: helperSha256 ?? '', executable: process.execPath }) : null;
	if (!windows) assert.ok(helperPath === undefined && helperSha256 === undefined, 'Windows helper inputs require Windows.');
	await mkdir(evidenceRoot, { mode: 0o700 }); await mkdir(workRoot, { mode: 0o700 });
	const ownedJobs = join(workRoot, 'jobs'); await mkdir(ownedJobs, { mode: 0o700 });
	let artifactBytes = 0, complete = false;
	const phases: Readonly<{ name: string; packageReceipt: string; smokeReceipt: string }>[] = [];
	const environment = new Map<string, string | undefined>();
	function set(name: string, value: string | undefined): void {
		if (!environment.has(name)) environment.set(name, process.env[name]);
		if (value === undefined) delete process.env[name]; else process.env[name] = value;
	}
	async function receipt(name: string, value: unknown): Promise<string> {
		const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
		assert.ok(bytes.length <= MAXIMUM_RECEIPT && artifactBytes + bytes.length <= MAXIMUM_ARTIFACT, 'Internal receipt artifact exceeded its byte budget.');
		artifactBytes += bytes.length; const path = join(evidenceRoot, name); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); return path;
	}
	try {
		set('LIGHTSCAPER_CI_SOURCE_ROOT', repositoryRoot); set('LIGHTSCAPER_CI_NPM_CLI', npmCli);
		set('SCAPE_PRODUCT', 'lightscaper'); set('SOUNDSCAPER_DESKTOP_TARGET_PLATFORM', plan.target.platform);
		set('SOUNDSCAPER_DESKTOP_TARGET_ARCH', plan.target.arch); set('SCAPE_MAC_SIGNING', 'false');
		set('SCAPE_WIN_SIGNING', 'none'); set('CSC_IDENTITY_AUTO_DISCOVERY', 'false');
		// The builder's realpath guard admits os.tmpdir(). Every stage/package is
		// below this exclusively created canonical private root, not a sibling tmp.
		set('TMPDIR', workRoot); set('TEMP', workRoot); set('TMP', workRoot);
		const entry = join(workRoot, 'public-package-entry.cjs');
		await writeFile(entry, "process.chdir(process.env.LIGHTSCAPER_CI_SOURCE_ROOT);\nprocess.argv[1] = process.env.LIGHTSCAPER_CI_NPM_CLI;\nrequire(process.argv[1]);\n", { flag: 'wx', mode: 0o600 });
		await receipt('host.json', { schemaVersion: 1, target: plan.target.target, sourceRevision: plan.sourceRevision,
			node: process.version, npm: npmPackage.version, nativeSourceInventorySha256: native.sourceInventorySha256 });
		for (const phase of plan.phases) {
			await mkdir(dirname(phase.buildRoot));
			set('SCAPE_DESKTOP_BUILD_ROOT', phase.buildRoot); set('LIGHTSCAPER_PHOTO_NATIVE_BUILD_RESULT', phase.nativeBuildResultRoot ?? undefined);
			const nonce = randomBytes(16).toString('hex');
			await receipt(`${phase.name}-package.intent.json`, { schemaVersion: 1, nonce, stage: 1, sourceRevision: plan.sourceRevision });
			const argv = [entry, 'run', 'desktop:dir', '--', '--' + plan.target.platform, '--' + plan.target.arch,
				'--publish', 'never', '--config.directories.output=' + phase.packageRoot];
			const processReceipt = windows ? await launchLightscaperWindowsJobProcessCurrentV1(windows, argv,
				{ nonce, stage: 1, receiptPath: join(ownedJobs, `${nonce}.stage-1.windows-job.json`) })
				: await launchLightscaperManagedSmokeProcessCurrentV1(process.execPath, argv);
			await receipt(`${phase.name}-package.process.json`, processReceipt);
			process.stdout.write(processReceipt.stdout); process.stderr.write(processReceipt.stderr);
			assert.equal(processReceipt.readersRetired, true, 'Packaging retirement is unproved; retain work.');
			assert.equal(processReceipt.exitCode, 0); assert.equal(processReceipt.signal, null);
			assert.equal(processReceipt.expired, false); assert.equal(processReceipt.forcedGroupRetirement, false); assert.equal(processReceipt.launchError, null);
			const app = await executable(phase.packageRoot, plan.target.platform, plan.target.arch);
			const resourcesRoot = plan.target.platform === 'mac' ? resolve(dirname(app), '../Resources') : join(dirname(app), 'resources');
			const packageReceipt = await verifyDesktopLightscaperPackageReceiptCurrentV1({ repositoryRoot, buildRoot: phase.buildRoot,
				resourcesRoot, target: { platform: plan.target.platform, arch: plan.target.arch } });
			assert.equal(packageReceipt.stage.sourceRevision, plan.sourceRevision);
			assert.equal(packageReceipt.stage.releaseChannel, 'deferred');
			if (phase.name === 'native') {
				assert.ok(packageReceipt.stage.nativePhotoRuntime, 'Native package silently fell back to Web-only.');
				assert.deepEqual(packageReceipt.stage.nativePhotoRuntime, native);
			} else assert.equal(packageReceipt.stage.nativePhotoRuntime, undefined, 'Fallback package still contains optional native services.');
			const packagePath = await receipt(`${phase.name}-package.json`, packageReceipt);
			const smokeArgs = ['--executable', app, '--runtime-root', join(resourcesRoot, 'runtime'), '--output-root', phase.smokeRoot,
				'--scenario', phase.scenario, '--backend', phase.backend,
				...(windows ? ['--windows-job-helper', windows.helper.path, '--windows-job-helper-sha256', windows.helper.sha256] : [])];
			const smokePath = await runLightscaperDesktopManagedSmokeCurrentV1(smokeArgs);
			const smoke: unknown = JSON.parse((await boundedRead(smokePath, 8 * 1024 * 1024)).toString('utf8'));
			assertSmoke(smoke, phase);
			const smokeReceipt = await receipt(`${phase.name}-smoke.json`, smoke);
			phases.push(Object.freeze({ name: phase.name, packageReceipt: packagePath, smokeReceipt }));
		}
		await retireLightscaperDesktopNativeWorkCurrentV1(workRoot); complete = true;
		return await receipt('qualification.json', { schemaVersion: 1, kind: 'lightscaper-internal-native-desktop-qualification-current-v1',
			status: 'passed', target: plan.target.target, sourceRevision: plan.sourceRevision, releaseChannel: 'deferred',
			phases, workRemoved: true, workRetained: false });
	} catch (error) {
		await receipt('failure.json', { schemaVersion: 1, status: 'failed', target: plan.target.target, sourceRevision: plan.sourceRevision,
			workRoot, workRetained: !complete, message: error instanceof Error ? error.message : 'Unknown internal qualification failure.', phases });
		throw error;
	} finally {
		for (const [name, value] of environment) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
	}
}
function readOptions(args: readonly string[]) {
	const names = ['--target', '--source-revision', '--native-result', '--work-root', '--evidence-root', '--npm-cli'];
	const values = new Map<string, string>();
	for (let at = 0; at < args.length; at++) {
		const name = args[at]!, value = args[++at];
		if (!names.includes(name) || values.has(name) || !value || value.includes('\0')) throw new TypeError('Internal qualification expects fixed, unique option/value pairs.');
		values.set(name, value);
	}
	for (const name of names) if (!values.has(name)) throw new TypeError(`Missing internal qualification option ${name}.`);
	function path(name: string): string {
		const value = values.get(name)!; if (!isAbsolute(value) || resolve(value) !== value) throw new TypeError('Internal qualification paths must be absolute canonical spellings.'); return value;
	}
	return { target: values.get('--target')!, sourceRevision: values.get('--source-revision')!, nativeResult: path('--native-result'),
		workRoot: path('--work-root'), evidenceRoot: path('--evidence-root'), npmCli: path('--npm-cli') };
}
function assertSmoke(value: unknown, phase: LightscaperDesktopNativeCiPhaseCurrentV1): void {
	assert.ok(value && typeof value === 'object' && 'status' in value && value.status === 'passed');
	assert.ok('backend' in value && value.backend === phase.backend);
	assert.ok('scenario' in value && value.scenario === phase.scenario);
	assert.ok('allowNoSandbox' in value && value.allowNoSandbox === false);
	assert.ok('threeFreshProcesses' in value && value.threeFreshProcesses === true);
	assert.ok('profileRemoved' in value && value.profileRemoved === true);
}
async function executable(root: string, platform: string, arch: string): Promise<string> {
	const suffix = arch === 'x64' ? '' : '-' + arch;
	const candidates = platform === 'mac' ? [join(root, 'mac' + suffix, 'Lightscaper.app/Contents/MacOS/Lightscaper'), join(root, 'mac', 'Lightscaper.app/Contents/MacOS/Lightscaper')]
		: platform === 'win' ? [join(root, 'win' + suffix + '-unpacked', 'Lightscaper.exe'), join(root, 'win-unpacked', 'Lightscaper.exe')]
			: [join(root, 'linux' + suffix + '-unpacked', 'lightscaper'), join(root, 'linux-unpacked', 'lightscaper')];
	const found: string[] = [];
	for (const candidate of new Set(candidates)) {
		try { const stat = await lstat(candidate); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(await realpath(candidate), candidate); found.push(candidate); }
		catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
	}
	assert.equal(found.length, 1, 'Exactly one real public unpacked executable is required.'); return found[0]!;
}
async function boundedRead(path: string, maximum: number): Promise<Buffer> {
	const before = await lstat(path); assert.ok(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= maximum);
	const bytes = await readFile(path); assert.equal(bytes.length, before.size); return bytes;
}
function overlaps(a: string, b: string): boolean {
	const inside = (parent: string, child: string): boolean => { const value = relative(parent, child); return !value || !isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep); };
	return inside(a, b) || inside(b, a);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	void runLightscaperDesktopNativeQualificationCurrentV1(process.argv.slice(2)).then(path => { console.log(`Internal native desktop qualification passed: ${path}`); },
		(error: unknown) => { console.error(error); process.exitCode = 1; });
}
