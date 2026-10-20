/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	createFramescaperMediaHostBuildCommands,
	framescaperMediaHostBuildPaths,
} from '../native/framescaper-media-host/build/media-build-commands.mjs';

interface NativeCommand {
	readonly phase: string;
	readonly executable: string;
	readonly cwd: string;
	readonly args: readonly string[];
	readonly environment: Readonly<Record<string, string>>;
}

const targets = ['win-x64', 'win-arm64', 'linux-x64', 'linux-arm64', 'mac-arm64'] as const;
const root = join(tmpdir(), 'motionscaper-libvpx-command-plan');
const paths = framescaperMediaHostBuildPaths(join(root, 'work'));
const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'];

function commandPlan(target: typeof targets[number], planRoot = root, workRoot = join(planRoot, 'work')): readonly NativeCommand[] {
	const windows = target.startsWith('win-');
	const planPaths = framescaperMediaHostBuildPaths(workRoot);
	const executables = Object.fromEntries(roles.map(role => [role, {
		path: windows && role === 'shell' ? String.raw`C:\Program Files\Git\bin\bash.exe`
			: join(planRoot, 'authenticated-tools', windows && (role === 'c' || role === 'cxx') ? 'cl.exe' : `${role}${windows ? '.exe' : ''}`),
	}]));
	return createFramescaperMediaHostBuildCommands({
		target: { id: target, cmakePreset: target }, hostRoot: join(planRoot, 'host'),
		ffmpegSourceRoot: join(planRoot, 'ffmpeg'), boostSourceRoot: join(planRoot, 'boost'), paths: planPaths,
		externalSourceRoots: Object.fromEntries(
			['x264', 'x265', 'libvpx', 'libopus', 'zlib'].map(id => [id, join(planRoot, 'sources', id)]),
		),
		tools: { executables },
		environment: { PATH: join(planRoot, 'authenticated-tools'), CC: 'ambient-cc', CXX: 'ambient-cxx', SOURCE_DATE_EPOCH: '1786492800', MSBUILDDISABLENODEREUSE: '0' },
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
			const expected = windows && name !== 'libvpx-configure'
				? { ...expectedEnvironment, MSBUILDDISABLENODEREUSE: '1' } : expectedEnvironment;
			assert.deepEqual(phase(commands, name).environment, expected,
				`${target}: libvpx must select native compilers and retire Windows build nodes after completion`);
		}
		for (const name of ['x264-build', 'x264-install', 'ffmpeg-configure', 'ffmpeg-build', 'ffmpeg-install']) {
			const environment = phase(commands, name).environment;
			assert.equal(environment.CC, codecEnvironment.CC, name);
			assert.equal(environment.CXX, codecEnvironment.CXX, name);
			assert.equal(environment.MSBUILDDISABLENODEREUSE, '0', name);
			if (!name.startsWith('ffmpeg-')) assert.ok(!phase(commands, name).args.some(argument => /^(?:SHELL|\.SHELLFLAGS)=/u.test(argument)), name);
			assert.ok(!('SHELL' in environment), name);
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
			assert.equal(configure.executable, String.raw`C:\Program Files\Git\bin\bash.exe`);
			for (const name of ['libvpx-build', 'libvpx-install']) {
				const command = phase(commands, name);
				assert.ok(command.args.includes('MSBUILD_TOOL=msbuild.exe'), 'generated VS projects must compile with the authenticated MSBuild tool');
				assert.deepEqual(command.args.filter(argument => /^(?:SHELL|\.SHELLFLAGS)=/u.test(argument)), [
					'SHELL=C:/Program Files/Git/bin/bash.exe', '.SHELLFLAGS=--noprofile --norc -c',
				], 'native make must run absolute scripts through the full authenticated shell and bypass direct script parsing');
				assert.ok(!('SHELL' in command.environment), 'the shell binding must survive recursive make as command arguments');
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
			assert.deepEqual(phase(commands, 'libvpx-build').args, ['-C', paths.libvpxBuild, '-j1']);
			assert.deepEqual(phase(commands, 'libvpx-install').args, ['-C', paths.libvpxBuild, 'install']);
			assert.ok(!commands.some(command => command.phase === 'libvpx-normalize-library'));
		}
	});
}

for (const target of ['win-x64', 'win-arm64'] as const) {
	test(`Motion ${target} preserves native make paths through libvpx configuration`, () => {
		const commands = commandPlan(target, String.raw`C:\motionscaper-libvpx-command-plan`);
		const configure = phase(commands, 'libvpx-configure');
		assert.equal(framescaperMediaHostBuildPaths(String.raw`C:\motionscaper-staged-work`).libvpxSource,
			join(String.raw`C:\motionscaper-staged-work`, 'libvpx-build', 'src'));
		assert.equal(configure.args[0], 'src/configure');
		assert.deepEqual([configure.args[0], configure.args.find(argument => argument.startsWith('--prefix='))], [
			'src/configure',
			'--prefix=C:/motionscaper-libvpx-command-plan/work/libvpx-install',
		], 'libvpx persists source and install paths in makefiles read by native Windows make');
		for (const codec of ['x264']) {
			const command = phase(commands, `${codec}-configure`);
			assert.deepEqual([command.args[0], command.args.find(argument => argument.startsWith('--prefix='))], [
				`/c/motionscaper-libvpx-command-plan/${codec === 'x264' ? 'sources/x264' : 'ffmpeg'}/configure`,
				`--prefix=/c/motionscaper-libvpx-command-plan/work/${codec}-install`,
			]);
		}
	});
}

for (const target of ['win-x64', 'win-arm64'] as const) {
	test(`Motion ${target} keeps staged libvpx source arguments short across deep and foreign source drives`, () => {
		for (const planRoot of [String.raw`D:\deep\source\tree`, ['C:', ...Array.from({ length: 60 }, () => 'nested'), 'source'].join('\\')]) {
			const commands = commandPlan(target, planRoot, String.raw`C:\motionscaper-staged-work`);
			assert.equal(phase(commands, 'libvpx-configure').args[0], 'src/configure');
		}
	});
}

for (const target of targets) {
	test(`Motion ${target} preserves the FFmpeg source and native install path contract`, () => {
		const windows = target.startsWith('win-');
		const workRoot = windows ? String.raw`C:\motionscaper-ffmpeg-work` : join(root, 'ffmpeg-work');
		for (const sourceRoot of windows ? [String.raw`D:\foreign\source`, ['C:', ...Array.from({ length: 60 }, () => 'nested'), 'source'].join('\\')] : [root]) {
			const commands = commandPlan(target, sourceRoot, workRoot);
			const configure = phase(commands, 'ffmpeg-configure');
			const install = framescaperMediaHostBuildPaths(workRoot).ffmpegInstall;
			assert.equal(configure.args[0], windows ? './src/configure' : join(sourceRoot, 'ffmpeg', 'configure'));
			assert.ok(configure.args.includes(`--prefix=${windows ? install.replaceAll('\\', '/') : install}`));
			assert.equal(configure.args.includes('--extra-cflags=-MT'), windows);
			for (const [name, operation] of [['ffmpeg-build', '-j1'], ['ffmpeg-install', 'install']] as const) {
				const command = phase(commands, name);
				assert.deepEqual(command.args, ['-C', framescaperMediaHostBuildPaths(workRoot).ffmpegBuild, operation,
					...(windows ? ['SHELL=C:/Program Files/Git/bin/bash.exe', '.SHELLFLAGS=--noprofile --norc -c',
						...['CCDEP', 'CXXDEP', 'ASDEP', 'HOSTCCDEP'].map(macro => `${macro}=`
							+ '$(DEP$(1)) $(DEP$(1)FLAGS) $($(1)DEP_FLAGS) $< 2>&1 | '
							+ 'awk -v target="$@" -f windows-msvc-dependencies.awk > $(@:.o=.d)')] : [])]);
				assert.ok(!('SHELL' in command.environment));
			}
		}
	});
}

for (const target of targets) {
	test(`Motion ${target} installs the x265 library name requested by pkg-config before FFmpeg`, () => {
		const workRoot = target.startsWith('win-') ? String.raw`C:\motionscaper-x265-work` : join(root, 'x265-work');
		const commands = commandPlan(target, root, workRoot);
		if (!target.startsWith('win-')) {
			assert.ok(!commands.some(command => command.phase === 'x265-normalize-library'));
			return;
		}
		const installed = framescaperMediaHostBuildPaths(workRoot);
		const normalize = phase(commands, 'x265-normalize-library');
		assert.equal(normalize.executable, phase(commands, 'x265-install').executable);
		assert.deepEqual(normalize.args, ['-E', 'copy',
			join(installed.x265Install, 'lib', 'x265-static.lib'),
			join(installed.x265Install, 'lib', 'x265.lib')]);
		assert.equal(normalize.cwd, installed.x265Build);
		assert.deepEqual(normalize.environment, phase(commands, 'x265-install').environment);
		assert.equal(commands.indexOf(normalize), commands.indexOf(phase(commands, 'x265-install')) + 1);
		assert.ok(commands.indexOf(normalize) < commands.indexOf(phase(commands, 'ffmpeg-configure')));
	});
}

for (const target of targets) {
	test(`Motion ${target} installs x265 static dependency metadata before FFmpeg`, () => {
		const windows = target.startsWith('win-');
		const sourceRoot = windows ? String.raw`D:\motionscaper-x265-source` : root;
		const workRoot = windows ? String.raw`C:\motionscaper-x265-work` : join(root, 'x265-work');
		const commands = commandPlan(target, sourceRoot, workRoot);
		if (!windows) {
			assert.ok(!commands.some(command => command.phase === 'x265-normalize-pkg-config'));
			return;
		}
		const installed = framescaperMediaHostBuildPaths(workRoot);
		const normalize = phase(commands, 'x265-normalize-pkg-config');
		assert.equal(normalize.executable, phase(commands, 'x265-install').executable);
		assert.deepEqual(normalize.args, ['-E', 'copy',
			join(sourceRoot, 'host', 'build', 'windows-x265.pc'),
			join(installed.x265Install, 'lib', 'pkgconfig', 'x265.pc')]);
		assert.equal(normalize.cwd, installed.x265Build);
		assert.deepEqual(normalize.environment, phase(commands, 'x265-install').environment);
		assert.equal(commands.indexOf(normalize), commands.indexOf(phase(commands, 'x265-normalize-library')) + 1);
		assert.ok(commands.indexOf(normalize) < commands.indexOf(phase(commands, 'ffmpeg-configure')));
	});
}

test('Motion Windows x265 metadata declares its pinned version and complete static dependency', () => {
	const hostRoot = resolve(import.meta.dirname, '../native/framescaper-media-host');
	const manifest = JSON.parse(readFileSync(join(hostRoot, 'build/ffmpeg-9.0.1-external-sources.json'), 'utf8')) as {
		readonly libraries: readonly { readonly id: string; readonly version: string }[];
	};
	const x265 = manifest.libraries.find(library => library.id === 'x265');
	assert.ok(x265);
	const source = readFileSync(join(hostRoot, 'build/windows-x265.pc'), 'utf8');
	const fields = new Map(source.split(/\r?\n/u).filter(line => line.includes(':')).map(line => {
		const colon = line.indexOf(':');
		return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as const;
	}));
	assert.equal(fields.get('Version'), x265.version);
	assert.equal(fields.get('Libs'), '-L${libdir} -lx265');
	assert.equal(fields.get('Libs.private'), '-ladvapi32');
	assert.equal(fields.get('Cflags'), '-I${includedir}');
	assert.match(source, /^prefix=\$\{pcfiledir\}\/\.\.\/\.\.$/mu);
});
