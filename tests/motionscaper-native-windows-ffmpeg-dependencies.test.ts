/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	createFramescaperMediaHostBuildCommands,
	framescaperMediaHostBuildPaths,
} from '../native/framescaper-media-host/build/media-build-commands.mjs';
import { createFramescaperMediaHostToolchainReceipt } from '../scripts/lib/framescaper-media-host-toolchain.mjs';

interface NativeCommand {
	readonly phase: string;
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly environment: Readonly<Record<string, string>>;
}
interface Tool { readonly path: string; readonly sha256?: string }
interface Toolchain {
	readonly executables: Readonly<Record<string, Tool>>;
	readonly environment: Readonly<Record<string, string>>;
}
type Target = 'win-x64' | 'win-arm64' | 'linux-x64' | 'linux-arm64' | 'mac-arm64';
const helperName = 'windows-msvc-dependencies.awk';
const helper = resolve(import.meta.dirname, '../native/framescaper-media-host/build', helperName);
const macros = ['CCDEP', 'CXXDEP', 'ASDEP', 'HOSTCCDEP'] as const;
const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'];
const dependencyCommand = '$(DEP$(1)) $(DEP$(1)FLAGS) $($(1)DEP_FLAGS) $< 2>&1 | '
	+ `awk -v target="$@" -f ${helperName} > $(@:.o=.d)`;
const input = 'Note: including file: C:\\SDK\\alpha.h\n'
	+ 'Note: including file: C:\\SDK With Space\\skip.h\n'
	+ 'unrelated diagnostic\nNote: including file: D:\\project\\sub\\beta.h\n';
const expected = (target: string) => `${target}: C:/SDK/alpha.h\n${target}: D:/project/sub/beta.h\n`;

function commands(target: Target, root: string, tools?: Toolchain, work = join(root, 'work with spaces')): readonly NativeCommand[] {
	const executables = tools?.executables ?? Object.fromEntries(roles.map(role => [role, {
		path: role === 'shell' ? 'C:/Program Files/Git/bin/bash.exe' : join(root, 'tools', `${role}.exe`),
	}]));
	return createFramescaperMediaHostBuildCommands({
		target: { id: target, cmakePreset: target }, hostRoot: join(root, 'host with spaces'),
		ffmpegSourceRoot: join(root, 'raw ffmpeg'), boostSourceRoot: join(root, 'boost'),
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(id => [id, join(root, id)])),
		paths: framescaperMediaHostBuildPaths(work), tools: { executables },
		environment: tools?.environment ?? { PATH: join(root, 'tools') }, configureFlags: [],
	}) as unknown as readonly NativeCommand[];
}

function phase(plan: readonly NativeCommand[], name: string): NativeCommand {
	const command = plan.find(candidate => candidate.phase === name);
	assert.ok(command, `Missing ${name}`);
	return command;
}

for (const target of ['win-x64', 'win-arm64'] as const) {
	test(`Motion ${target} stages the pinned dependency filter before both FFmpeg make phases`, () => {
		const root = [String.raw`D:\Motion source with spaces`, ...Array.from({ length: 20 }, () => 'deep')].join('\\');
		const work = String.raw`C:\Motion work with spaces`;
		const plan = commands(target, root, undefined, work);
		const paths = framescaperMediaHostBuildPaths(work);
		const prepare = phase(plan, 'ffmpeg-prepare-dependencies');
		assert.equal(prepare.executable, phase(plan, 'x265-install').executable);
		assert.deepEqual(prepare.args, ['-E', 'copy', join(root, 'host with spaces', 'build', helperName), join(paths.ffmpegBuild, helperName)]);
		assert.equal(prepare.cwd, paths.ffmpegBuild);
		assert.deepEqual(prepare.environment, phase(plan, 'x265-install').environment);
		assert.equal(plan.indexOf(prepare), plan.indexOf(phase(plan, 'ffmpeg-configure')) + 1);
		assert.equal(plan.indexOf(phase(plan, 'ffmpeg-build')), plan.indexOf(prepare) + 1);
		for (const [name, operation] of [['ffmpeg-build', '-j1'], ['ffmpeg-install', 'install']] as const) {
			const command = phase(plan, name);
			const ffmpegSource = join(root, 'raw ffmpeg').replaceAll('\\', '/');
			assert.deepEqual(command.args, ['-C', paths.ffmpegBuild, operation,
				'-f', `${ffmpegSource}/Makefile`, `SRC_PATH=${ffmpegSource}`, `SRC_LINK=${ffmpegSource}`,
				'SHELL=C:/Program Files/Git/bin/bash.exe', '.SHELLFLAGS=-e -c',
				...macros.map(macro => `${macro}=${dependencyCommand}`)]);
			assert.ok(!('SHELL' in command.environment));
			const configureEnvironment = phase(plan, 'ffmpeg-configure').environment;
			assert.deepEqual(command.environment, { ...configureEnvironment,
				PATH: `C:/Program Files/Git/bin;${configureEnvironment.PATH}` });
		}
		for (const name of ['x264-build', 'x264-install', 'libvpx-build', 'libvpx-install']) {
			assert.ok(!phase(plan, name).args.some(argument => macros.some(macro => argument.startsWith(`${macro}=`))));
		}
	});
}

for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64'] as const) {
	test(`Motion ${target} retains its original FFmpeg make arguments`, () => {
		const root = join(tmpdir(), 'motion dependencies');
		const plan = commands(target, root);
		const paths = framescaperMediaHostBuildPaths(join(root, 'work with spaces'));
		assert.ok(!plan.some(command => command.phase === 'ffmpeg-prepare-dependencies'));
		assert.deepEqual(phase(plan, 'ffmpeg-build').args, ['-C', paths.ffmpegBuild, '-j1']);
		assert.deepEqual(phase(plan, 'ffmpeg-install').args, ['-C', paths.ffmpegBuild, 'install']);
	});
}

test('Motion dependency filter preserves upstream Windows include-path semantics', context => {
	assert.ok(existsSync(helper), 'The maintained source closure must contain the dependency filter');
	if (process.platform === 'win32') return context.skip('Covered by the authenticated Windows make transport fixture');
	const result = spawnSync('awk', ['-v', 'target=libavcodec/probe.o', '-f', helper], {
		input, encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
	});
	assert.ifError(result.error);
	assert.equal(result.signal, null);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, expected('libavcodec/probe.o'));
});

test('Motion Windows executes both planned make transports with all four dependency filters', context => {
	if (process.platform !== 'win32' || process.arch !== 'x64') return context.skip('Windows x64 authenticated native-tool fixture');
	const tools = createFramescaperMediaHostToolchainReceipt({ targetId: 'win-x64' }) as unknown as Toolchain;
	const root = mkdtempSync(join(tmpdir(), 'motion dependency transport with spaces '));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = commands('win-x64', root, tools);
	const prepare = phase(plan, 'ffmpeg-prepare-dependencies');
	const paths = framescaperMediaHostBuildPaths(join(root, 'work with spaces'));
	mkdirSync(paths.ffmpegBuild, { recursive: true });
	// The actual copy command reads the real pinned helper from a source path with spaces.
	const source = prepare.args[2];
	assert.ok(source);
	mkdirSync(dirname(source), { recursive: true });
	copyFileSync(helper, source);
	const fixture = [
		'.PHONY: all install intentional-failure',
		'DEPCC=cat', 'DEPCXX=cat', 'DEPAS=cat', 'DEPHOSTCC=cat',
		...macros.map(macro => `${macro}=exit 91`),
		...['CC', 'CXX', 'AS', 'HOSTCC'].map(role => `${role}=printf compiled > $@.compiled`),
		// Exact pinned ffbuild/common.mak COMPILE grouping: dependency then compiler.
		'define COMPILE',
		'       $(call $(1)DEP,$(1))',
		'       $($(1)) $($(1)FLAGS) $($(2)) $($(1)_DEPFLAGS) $($(1)_C) $($(1)_O) $(patsubst $(SRC_PATH)/%,$(SRC_LINK)/%,$<)',
		'endef',
		'all: probe-cc.o probe-cxx.o probe-as.o probe-host.o',
		'\t@printf "complete\\n" > completed-marker.txt',
		'install: all',
		'probe-cc.o: include-lines.txt', '\t$(call COMPILE,CC)',
		'probe-cxx.o: include-lines.txt', '\t$(call COMPILE,CXX)',
		'probe-as.o: include-lines.txt', '\t$(call COMPILE,AS)',
		'probe-host.o: include-lines.txt', '\t$(call COMPILE,HOSTCC)',
		'intentional-failure:', '\t@printf "reached\\n" > failure-reached.txt', '\t@exit 7',
		'\t@printf "unexpected\\n" > later-marker.txt',
	].join('\n') + '\n';
	const makefileIndex = phase(plan, 'ffmpeg-build').args.indexOf('-f');
	const makefile = phase(plan, 'ffmpeg-build').args[makefileIndex + 1];
	assert.ok(makefileIndex >= 0 && makefile);
	mkdirSync(dirname(makefile), { recursive: true });
	writeFileSync(makefile, fixture);
	writeFileSync(join(paths.ffmpegBuild, 'include-lines.txt'), input);
	const run = (command: NativeCommand, args: readonly string[] = command.args) => {
		const result = spawnSync(command.executable, [...args], {
			cwd: command.cwd, env: { ...command.environment, LC_ALL: 'C' }, windowsHide: true,
			encoding: 'utf8', timeout: 10000, maxBuffer: 65536,
		});
		assert.ifError(result.error);
		assert.equal(result.signal, null);
		return result;
	};
	assert.equal(run(prepare).status, 0);
	assert.deepEqual(readFileSync(join(paths.ffmpegBuild, helperName)), readFileSync(helper));
	for (const name of ['ffmpeg-build', 'ffmpeg-install']) {
		const command = phase(plan, name);
		const result = run(command);
		assert.equal(result.status, 0, result.stderr);
		for (const suffix of ['cc', 'cxx', 'as', 'host']) {
			assert.equal(readFileSync(join(paths.ffmpegBuild, `probe-${suffix}.d`), 'utf8'), expected(`probe-${suffix}.o`));
			assert.equal(readFileSync(join(paths.ffmpegBuild, `probe-${suffix}.o.compiled`), 'utf8'), 'compiled');
		}
		assert.equal(readFileSync(join(paths.ffmpegBuild, 'completed-marker.txt'), 'utf8'), 'complete\n');
		const failed = run(command, [...command.args, 'intentional-failure']);
		assert.equal(failed.status, 2, failed.stderr);
		assert.match(failed.stderr, /intentional-failure\][^\r\n]*Error 7/u);
		assert.equal(readFileSync(join(paths.ffmpegBuild, 'failure-reached.txt'), 'utf8'), 'reached\n');
		assert.equal(existsSync(join(paths.ffmpegBuild, 'later-marker.txt')), false);
		rmSync(join(paths.ffmpegBuild, 'failure-reached.txt'));
	}
});
