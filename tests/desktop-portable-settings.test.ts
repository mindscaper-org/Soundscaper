/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { configureDesktopStorage } from '../desktop/desktop-storage-bootstrap.ts';
import { createSoundscaperDesktopProjectLibraryPaths } from '../desktop/soundscaper-project-library-contract.ts';
import { DesktopSettingsStore } from '../desktop/settings.js';

interface FixtureOptions {
	readonly platform?: NodeJS.Platform;
	readonly appName?: 'Soundscaper' | 'Framescaper';
	readonly entry?: 'directory' | 'file' | 'absent';
	readonly userDataOverride?: boolean;
	readonly argv?: readonly string[];
	readonly launcher?: 'appimage' | 'windows-directory' | 'windows-file';
}

async function fixture(t: test.TestContext, options: FixtureOptions = {}) {
	const root = await mkdtemp(join(tmpdir(), 'scape-portable-settings-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const home = join(root, 'home');
	const executableDirectory = join(root, 'application');
	const portableRoot = join(executableDirectory, 'Portable Settings');
	const appName = options.appName ?? 'Soundscaper';
	const appData = join(home, '.config');
	const userData = join(appData, appName);
	await mkdir(executableDirectory, { recursive: true });
	await mkdir(userData, { recursive: true });
	await writeFile(join(userData, 'desktop-settings.json'), 'installed settings');
	const entry = options.entry ?? 'directory';
	if (entry === 'directory') await mkdir(portableRoot);
	if (entry === 'file') await writeFile(portableRoot, 'not a directory');
	const environment: Record<string, string> = {};
	let executable = join(executableDirectory, appName);
	if (options.launcher) {
		executable = join(root, 'extracted', appName);
		if (options.launcher === 'appimage') environment.APPIMAGE = join(executableDirectory, `${appName}.AppImage`);
		if (options.launcher === 'windows-directory') environment.PORTABLE_EXECUTABLE_DIR = executableDirectory;
		if (options.launcher === 'windows-file') environment.PORTABLE_EXECUTABLE_FILE = join(executableDirectory, `${appName}.exe`);
	}
	const paths = new Map<string, string>([
		['home', home], ['appData', appData], ['userData', userData], ['exe', executable],
	]);
	const switches = new Map<string, string>();
	const storage = configureDesktopStorage({
		app: {
			getPath: (name) => { const path = paths.get(name); assert.ok(path); return path; },
			setPath: (name, path) => { paths.set(name, path); },
			setAppLogsPath: (path) => { paths.set('logs', path); },
			commandLine: {
				getSwitchValue: () => options.userDataOverride ? userData : '',
				appendSwitch: (name, value) => { switches.set(name, value); },
			},
		},
		appName, platform: options.platform ?? 'linux', environment, argv: options.argv ?? [],
	});
	return { root, home, portableRoot, appData, userData, paths, switches, storage };
}

test('an existing Portable Settings directory owns the profile and library on every desktop platform', async (t) => {
	for (const platform of ['linux', 'win32', 'darwin'] as const) {
		for (const appName of ['Soundscaper', 'Framescaper'] as const) {
			const f = await fixture(t, { platform, appName });
			assert.equal(f.paths.get('userData'), f.portableRoot, 'select the profile before the instance lock');
			assert.equal(f.paths.has('sessionData'), false, 'prepare the remaining paths under the instance lock');
			for (const key of ['configRoot', 'dataRoot', 'cacheRoot', 'stateRoot', 'sessionDataRoot', 'projectLibraryAppData'] as const) {
				assert.equal(f.storage[key], f.portableRoot);
			}
			assert.equal(f.storage.renderInputRoot, join(f.portableRoot, 'framescaper-native-render-inputs'));
			assert.equal(f.storage.xdgEnabled, false);
			assert.equal(f.storage.portable, true);
			f.storage.prepareBeforeReady();
			assert.equal(f.paths.get('sessionData'), f.portableRoot);
			assert.equal(f.paths.get('logs'), join(f.portableRoot, 'logs'));
			assert.equal(f.paths.get('crashDumps'), join(f.portableRoot, 'Crashpad'));
			assert.ok((await lstat(f.paths.get('crashDumps')!)).isDirectory());
			assert.equal(await f.storage.projectsDirectory(), null);
			await f.storage.migrate();
			assert.equal(await readFile(join(f.userData, 'desktop-settings.json'), 'utf8'), 'installed settings');
			await assert.rejects(lstat(join(f.home, '.local')), { code: 'ENOENT' });
		}
	}
});

test('portable startup keeps installed settings and project libraries separate', async (t) => {
	const f = await fixture(t);
	const installedLibrary = join(f.appData, 'kw.media', 'soundscaper-project-library', 'v1');
	await mkdir(installedLibrary, { recursive: true });
	await writeFile(join(installedLibrary, 'library.sqlite3'), 'installed library');
	const settingsPath = join(f.portableRoot, 'desktop-settings.json');
	await writeFile(settingsPath, JSON.stringify({ schemaVersion: 1, locale: 'de' }));
	f.storage.prepareBeforeReady();
	f.storage.prepareBeforeReady();
	await f.storage.migrate();
	const paths = createSoundscaperDesktopProjectLibraryPaths(f.storage.projectLibraryAppData);
	assert.equal(paths.libraryRoot, join(f.portableRoot, 'Soundscaper', 'project-library', 'v1'));
	await mkdir(paths.libraryRoot, { recursive: true });
	await writeFile(paths.databasePath, 'portable library');
	assert.equal(await readFile(join(installedLibrary, 'library.sqlite3'), 'utf8'), 'installed library');
	const settings = new DesktopSettingsStore(join(f.storage.configRoot, 'desktop-settings.json'));
	assert.equal((await settings.load()).locale, 'de');
	await settings.setLocale('fr');
	const reopened = new DesktopSettingsStore(settingsPath);
	assert.equal((await reopened.load()).locale, 'fr');
	assert.equal(await readFile(join(f.userData, 'desktop-settings.json'), 'utf8'), 'installed settings');
	await assert.rejects(lstat(join(f.appData, 'Soundscaper', 'project-library')), { code: 'ENOENT' });
});

test('an unwritable portable profile reports the failure and retains the selected profile', {
	skip: process.platform === 'win32' || process.getuid?.() === 0,
}, async (t) => {
	const f = await fixture(t);
	await chmod(f.portableRoot, 0o500);
	try {
		assert.throws(() => f.storage.prepareBeforeReady(), { code: 'EACCES' });
		assert.equal(f.paths.get('userData'), f.portableRoot);
	} finally {
		await chmod(f.portableRoot, 0o700);
	}
	f.storage.prepareBeforeReady();
	assert.equal(f.paths.get('sessionData'), f.portableRoot);
});

test('missing Portable Settings folders and same-named files keep the normal storage layout', async (t) => {
	for (const entry of ['absent', 'file'] as const) {
		const f = await fixture(t, { entry });
		assert.equal(f.paths.get('userData'), f.userData);
		assert.equal(f.storage.configRoot, f.userData);
		assert.equal(f.storage.portable, false);
		assert.equal(f.storage.dataRoot, join(f.home, '.local', 'share', 'Soundscaper'));
		if (entry === 'absent') await assert.rejects(lstat(f.portableRoot), { code: 'ENOENT' });
		else assert.equal(await readFile(f.portableRoot, 'utf8'), 'not a directory');
	}
});

test('explicit profiles and diagnostic launches take precedence over adjacent portable settings', async (t) => {
	for (const options of [
		{ userDataOverride: true },
		{ argv: ['--soundscaper-smoke'] },
		{ argv: ['--soundscaper-nightly-tests-base-url=http://127.0.0.1:4321'] },
		{ argv: ['--soundscaper-soak-debug'] },
	]) {
		const f = await fixture(t, options);
		f.storage.prepareBeforeReady();
		await f.storage.migrate();
		assert.equal(f.paths.get('userData'), f.userData);
		assert.equal(f.storage.configRoot, f.userData);
		assert.equal(f.storage.projectLibraryAppData, f.appData);
		assert.equal(f.storage.portable, false);
	}
});

test('self-extracting launches look beside the outer executable instead of its temporary extraction', async (t) => {
	for (const [platform, launcher] of [
		['linux', 'appimage'], ['win32', 'windows-directory'], ['win32', 'windows-file'],
	] as const) {
		const f = await fixture(t, { platform, launcher });
		assert.equal(f.paths.get('userData'), f.portableRoot);
		assert.equal(f.storage.projectLibraryAppData, f.portableRoot);
	}
});
