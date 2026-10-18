/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createFramescaperMediaHostBuildCommands,
	framescaperMediaHostBuildPaths,
} from '../native/framescaper-media-host/build/media-build-commands.mjs';

interface NativeCommand {
	readonly phase: string;
	readonly executable: string;
	readonly args: readonly string[];
	readonly environment: Readonly<Record<string, string>>;
}

const targets = ['win-x64', 'win-arm64', 'linux-x64', 'linux-arm64', 'mac-arm64'] as const;
const root = join(tmpdir(), 'motionscaper-libvpx-command-plan');
const paths = framescaperMediaHostBuildPaths(join(root, 'work'));
const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'];

function commandPlan(target: typeof targets[number], planRoot = root): readonly NativeCommand[] {
	const windows = target.startsWith('win-');
	const planPaths = framescaperMediaHostBuildPaths(join(planRoot, 'work'));
	const executables = Object.fromEntries(roles.map(role => [role, {
		path: join(planRoot, 'authenticated-tools', windows && (role === 'c' || role === 'cxx') ? 'cl.exe' : `${role}${windows ? '.exe' : ''}`),
	}]));
	return createFramescaperMediaHostBuildCommands({
		target: { id: target, cmakePreset: target }, hostRoot: join(planRoot, 'host'),
		ffmpegSourceRoot: join(planRoot, 'ffmpeg'), boostSourceRoot: join(planRoot, 'boost'), paths: planPaths,
		externalSourceRoots: Object.fromEntries(
			['x264', 'x265', 'libvpx', 'libopus', 'zlib'].map(id => [id, join(planRoot, 'sources', id)]),
		),
		tools: { executables },
		environment: { PATH: join(planRoot, 'authenticated-tools'), CC: 'ambient-cc', CXX: 'ambient-cxx', SOURCE_DATE_EPOCH: '1786492800' },
		configureFlags: [],
	}) as unknown as readonly NativeCommand[];
}

function phase(commands: readonly NativeCommand[], name: string): NativeCommand {
	const command = commands.find(candidate => candidate.phase === name);
	assert.ok(command, `Missing ${name} command`);
	return command;
}

for (const target of targets) {
	test(`Motion ${target} selects the libvpx toolchain without changing other codec compilers`, () => {
		const commands = commandPlan(target);
		const configure = phase(commands, 'libvpx-configure');
		const windows = target.startsWith('win-');
		const codecEnvironment = phase(commands, 'x264-configure').environment;
		const expectedEnvironment = windows ? { ...codecEnvironment, CC: '', CXX: '' } : codecEnvironment;
		for (const name of ['libvpx-configure', 'libvpx-build', 'libvpx-install']) {
			assert.deepEqual(phase(commands, name).environment, expectedEnvironment,
				`${target}: libvpx must select upstream's native VS project path without ambient CC/CXX`);
		}
		for (const name of ['x264-build', 'x264-install', 'ffmpeg-configure', 'ffmpeg-build', 'ffmpeg-install']) {
			const environment = phase(commands, name).environment;
			assert.equal(environment.CC, codecEnvironment.CC, name);
			assert.equal(environment.CXX, codecEnvironment.CXX, name);
		}
		assert.equal(codecEnvironment.CC, windows ? 'cl.exe' : join(root, 'authenticated-tools', 'c'));
		assert.equal(codecEnvironment.CXX, windows ? 'cl.exe' : join(root, 'authenticated-tools', 'cxx'));
		assert.ok(configure.args.includes('--enable-vp9'));
		assert.ok(configure.args.includes('--disable-shared'));
		assert.ok(configure.args.includes('--enable-static'));
		assert.ok(!configure.args.includes('--enable-external-build'), 'upstream must select VS mode after common flag detection');
		assert.equal(phase(commands, 'libvpx-build').executable, join(root, 'authenticated-tools', `make${windows ? '.exe' : ''}`));
		assert.ok(phase(commands, 'libvpx-build').args.includes('-j1'));
		assert.ok(phase(commands, 'libvpx-install').args.includes('install'));
		if (windows) {
			assert.ok(configure.args.includes(`--target=${target === 'win-x64' ? 'x86_64' : 'arm64'}-win64-vs17`));
			assert.ok(configure.args.includes('--enable-static-msvcrt'));
			for (const name of ['libvpx-build', 'libvpx-install']) {
				assert.ok(phase(commands, name).args.includes('MSBUILD_TOOL=msbuild.exe'), 'generated VS projects must compile with the authenticated MSBuild tool');
			}
			assert.ok(phase(commands, 'libvpx-normalize-library').args.includes(
				join(paths.libvpxInstall, 'lib', target === 'win-x64' ? 'x64' : 'ARM64', 'vpxmt.lib'),
			));
		} else {
			assert.deepEqual([configure.args[0], configure.args.find(argument => argument.startsWith('--prefix='))], [
				join(root, 'sources', 'libvpx', 'configure'), `--prefix=${paths.libvpxInstall}`,
			]);
			assert.ok(configure.args.includes('--target=generic-gnu'));
			assert.ok(!configure.args.includes('--enable-static-msvcrt'));
			assert.ok(!phase(commands, 'libvpx-build').args.some(argument => argument.startsWith('MSBUILD_TOOL=')));
			assert.ok(!commands.some(command => command.phase === 'libvpx-normalize-library'));
		}
	});
}

for (const target of ['win-x64', 'win-arm64'] as const) {
	test(`Motion ${target} preserves native make paths through libvpx configuration`, () => {
		const commands = commandPlan(target, String.raw`C:\motionscaper-libvpx-command-plan`);
		const configure = phase(commands, 'libvpx-configure');
		assert.deepEqual([configure.args[0], configure.args.find(argument => argument.startsWith('--prefix='))], [
			'C:/motionscaper-libvpx-command-plan/sources/libvpx/configure',
			'--prefix=C:/motionscaper-libvpx-command-plan/work/libvpx-install',
		], 'libvpx persists source and install paths in makefiles read by native Windows make');
		for (const codec of ['x264', 'ffmpeg']) {
			const command = phase(commands, `${codec}-configure`);
			assert.deepEqual([command.args[0], command.args.find(argument => argument.startsWith('--prefix='))], [
				`/c/motionscaper-libvpx-command-plan/${codec === 'x264' ? 'sources/x264' : 'ffmpeg'}/configure`,
				`--prefix=/c/motionscaper-libvpx-command-plan/work/${codec}-install`,
			]);
		}
	});
}
