/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
// The supported entry point initializes this package's interdependent CommonJS classes.
import { WinPackager } from 'app-builder-lib';
import type { WindowsConfiguration } from 'app-builder-lib/out/options/winOptions.js';
import { DO_NOT_USE_HARD_LINKS, FileCopier, type FileTransformer } from 'builder-util/out/fs.js';

interface Configuration { win: WindowsConfiguration }
interface ControlledOwner {
	platformSpecificBuildOptions: WindowsConfiguration;
	shouldSignFile(file: string, fallback?: boolean): boolean;
	signIf(file: string): Promise<boolean>;
}
const helperName = 'motionscaper-media-host.exe';
function configuration(product: 'soundscaper' | 'framescaper' | 'motionscaper'): Configuration {
	// Execute only the real configuration, with inert credential-shaped values.
	return JSON.parse(execFileSync(process.execPath, ['-e', `Object.defineProperty(process, 'platform', { value: 'win32' }); console.log(JSON.stringify(require('./electron-builder.config.cjs')));`], {
		cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
		env: { ...process.env, SCAPE_PRODUCT: product, SCAPE_MAC_SIGNING: 'false', SCAPE_WIN_SIGNING: 'azure',
			AZURE_TENANT_ID: 'controlled', AZURE_CLIENT_ID: 'controlled', AZURE_CLIENT_SECRET: 'controlled',
			AZURE_SIGNING_ENDPOINT: 'https://controlled.invalid', AZURE_SIGNING_ACCOUNT: 'controlled',
			AZURE_SIGNING_PROFILE: 'controlled', WINDOWS_PUBLISHER_NAME: 'Controlled Publisher' },
	})) as Configuration;
}
function installedOwner(options: WindowsConfiguration, signed: string[]): ControlledOwner {
	const predicate: unknown = Reflect.get(WinPackager.prototype, 'shouldSignFile');
	assert.equal(typeof predicate, 'function');
	return {
		platformSpecificBuildOptions: options,
		shouldSignFile(file, fallback = false) {
			return (predicate as (this: ControlledOwner, path: string, fallback: boolean) => boolean).call(this, file, fallback);
		},
		async signIf(file) {
			signed.push(file); await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('CONTROLLED-SIGNATURE')])); return true;
		},
	};
}
function extraFilesTransformer(owner: ControlledOwner, appOutDir: string): FileTransformer | null {
	const factory: unknown = Reflect.get(WinPackager.prototype, 'createTransformerForExtraFiles');
	assert.equal(typeof factory, 'function');
	return (factory as (this: ControlledOwner, context: { appOutDir: string }) => FileTransformer | null).call(owner, { appOutDir });
}

test('Motion Windows helper is excluded by the installed builder even when default signing is requested', () => {
	const owner = installedOwner(configuration('motionscaper').win, []);
	for (const fallback of [false, true]) {
		assert.equal(owner.shouldSignFile(`resources/runtime/motionscaper-media-host/${helperName}`, fallback), false);
		for (const file of ['Motionscaper.exe', 'Motionscaper-setup.exe', 'Uninstall Motionscaper.exe', 'resources/other-helper.exe']) {
			assert.equal(owner.shouldSignFile(file, fallback), true, file);
		}
	}
});

test('installed extra-resource copier leaves the admitted Motion helper intact and signs other destination executables', async t => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-win-signing-')); t.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, 'source'), output = join(root, 'package'); await mkdir(source); await mkdir(output);
	const signed: string[] = [], owner = installedOwner(configuration('motionscaper').win, signed);
	const transformer = extraFilesTransformer(owner, output); assert.ok(transformer);
	const copier = new FileCopier(DO_NOT_USE_HARD_LINKS, transformer);
	const original = Buffer.from('controlled compiled helper bytes');
	for (const name of [helperName, 'another-helper.exe']) {
		const input = join(source, name), destination = join(output, name); await writeFile(input, original);
		await copier.copy(input, destination, await lstat(input));
		assert.deepEqual(await readFile(input), original, 'the original compile input is unchanged');
		if (name === helperName) assert.deepEqual(await readFile(destination), original, 'authenticated helper must retain its compiled digest');
		else assert.deepEqual(await readFile(destination), Buffer.concat([original, Buffer.from('CONTROLLED-SIGNATURE')]));
	}
	assert.deepEqual(signed, [join(output, 'another-helper.exe')]);
});

test('Motion exclusion preserves Windows signing configuration and leaves Soundscaper and Framescaper unchanged', () => {
	const motion = configuration('motionscaper').win;
	assert.deepEqual(motion.signExts, [`!${helperName}`]);
	for (const product of ['soundscaper', 'framescaper'] as const) {
		const baseline = configuration(product).win;
		assert.equal(baseline.signExts, undefined);
		assert.deepEqual({ ...motion, signExts: undefined }, { ...baseline, signExts: undefined });
		assert.equal(installedOwner(baseline, []).shouldSignFile(`runtime/${helperName}`, true), true);
	}
});
