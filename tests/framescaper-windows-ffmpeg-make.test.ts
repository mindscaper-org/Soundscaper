/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

function commands(root: string, source: string, shell: string, target = 'win-x64', hostRoot = root) {
	const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell']
		.map(role => [role, { path: role === 'shell' ? shell : `/tools/${role}` }]));
	return createFramescaperMediaHostBuildCommands({ target: { id: target, cmakePreset: target },
		hostRoot, ffmpegSourceRoot: source, boostSourceRoot: '/boost', paths: framescaperMediaHostBuildPaths(root),
		tools: { executables }, environment: { PATH: process.env.PATH }, configureFlags: [],
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(role => [role, source])),
	}) as readonly { phase: string; args: readonly string[]; cwd: string }[];
}

const shell = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/bash';
const hasTools = existsSync(shell) && spawnSync('make', ['--version']).status === 0;

test('Windows FFmpeg uses native Make source paths and the attested Git shell', () => {
	for (const target of ['win-x64', 'win-arm64']) {
		const plan = commands('D:/work', 'C:/sources/ffmpeg', 'C:/Program Files/Git/bin/bash.exe', target);
		for (const command of plan.filter(({ phase }) => ['ffmpeg-build', 'ffmpeg-install'].includes(phase))) {
			assert.ok(command.args.includes('-f'));
			assert.ok(command.args.includes('C:/sources/ffmpeg/Makefile'));
			assert.ok(command.args.includes('SRC_PATH=C:/sources/ffmpeg'));
			assert.ok(command.args.includes('SRC_LINK=C:/sources/ffmpeg'));
			assert.ok(command.args.includes('SHELL=C:/Program Files/Git/bin/bash.exe'));
			assert.ok(command.args.includes('.SHELLFLAGS=-e -c'));
		}
		assert.ok(plan.find(({ phase }) => phase === 'ffmpeg-configure')!.args.includes('--prefix=D:/work/ffmpeg-install'));
	}
});

// The failed awk program was captured from native Windows job 122201015453.
// config.mak was not retained; only automatic target/$ escaping is restored to
// replay that exact malformed program through real Make on the local host.
const capturedDependencyFilter = String.raw`/including/ { sub(/^.*file: */, ""); gsub(/\/, "/"); if (!match($$0, / /)) print "$@:", $$0 }`;
const hostRoot = resolve(import.meta.dirname, '../native/framescaper-media-host');
for (const role of ['CC', 'CXX'] as const) test(`Windows FFmpeg ${role} dependencies survive captured quoting failure and preserve compiler failures atomically`, { skip: !hasTools }, context => {
	const root = mkdtempSync(join(tmpdir(), 'framescaper-ffmpeg-dependencies-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, 'source'), compiler = join(root, 'compiler with  multiple spaces.sh'), capturedArguments = join(root, 'dependency-arguments');
	mkdirSync(source); writeFileSync(join(source, 'input with spaces.c'), '/* native compiler input */\n');
	writeFileSync(compiler, String.raw`#!/bin/bash
set -eu
case " $* " in
  *' -Zs '*) printf '%s\0' "$@" > "$FFMPEG_DEP_FIXTURE_ARGUMENTS";;
  *) : > compiled.marker; exit 0;;
esac
printf '%s\r\n' 'Note: including file: C:\sdk\header.h' 'Note: including file: D:\headers\deep.h' 'Note: including file: C:\sdk\directory with spaces\omitted.h' 'compiler informational output'
if [[ -v FFMPEG_DEP_FIXTURE_FAILURE ]]; then
  printf '%s\n' 'compiler-fixture-failure-sentinel' >&2
fi
printf '%017000d\n' 0 >&2
printf '%s\n' 'compiler-diagnostic-tail-must-not-appear' >&2
printf '%s\r\n' 'Note: including file: E:\late\after-cap.h'
if [[ -v FFMPEG_DEP_FIXTURE_FAILURE ]]; then exit 23; fi
`, { mode: 0o755 });
	writeFileSync(join(source, 'Makefile'), `include ffbuild/config.mak\nSILENT = DEPCC DEPCXX\n$(foreach VAR,$(SILENT),$(eval override $(VAR) = @$($(VAR))))\nall: libavdevice/alldevices.o\ndefine COMPILE\n$(call $(1)DEP,$(1))\n$(SHELL) "${compiler.replaceAll('\\', '/')}" -c "$<"\nendef\nlibavdevice/alldevices.o: $(SRC_PATH)/input\\ with\\ spaces.c\n\t$(call COMPILE,${role})\n`);
	const command = commands(root, source, shell, 'win-x64', hostRoot).find(value => value.phase === 'ffmpeg-build')!;
	mkdirSync(join(command.cwd, 'ffbuild'), { recursive: true }); mkdirSync(join(command.cwd, 'libavdevice'));
	const dependencyCommand = `$(DEP$(1)) $(DEP$(1)FLAGS) $($(1)DEP_FLAGS) "$<" 2>&1 | awk '${capturedDependencyFilter}' > $(@:.o=.d)`;
	// Upstream config has independent compiler variables before common.mak adds
	// exactly one silence prefix. A recursive DEPCXX alias would fabricate @@.
	writeFileSync(join(command.cwd, 'ffbuild/config.mak'), `DEPCC="${compiler.replaceAll('\\', '/')}"\nDEPCXX="${compiler.replaceAll('\\', '/')}"\nDEPCCFLAGS='-Iinclude with spaces' 'C:\\sdk\\compiler-option' '@response with  spaces.rsp' '-DFIXTURE=@literal-flag'\nDEPCXXFLAGS=$(DEPCCFLAGS)\nCCDEP_FLAGS=-showIncludes -Zs\nCXXDEP_FLAGS=$(CCDEP_FLAGS)\nCCDEP=${dependencyCommand}\nCXXDEP=$(CCDEP)\n`);
	const environment = { ...process.env, FFMPEG_DEP_FIXTURE_ARGUMENTS: capturedArguments };
	const result = spawnSync('make', [...command.args], { cwd: dirname(command.cwd), encoding: 'utf8', env: environment });
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.ok(result.stderr.length <= 16_384);
	assert.doesNotMatch(result.stderr, /compiler-diagnostic-tail-must-not-appear/u);
	const dependency = join(command.cwd, 'libavdevice/alldevices.d');
	assert.equal(readFileSync(dependency, 'utf8'), 'libavdevice/alldevices.o: C:/sdk/header.h\nlibavdevice/alldevices.o: D:/headers/deep.h\nlibavdevice/alldevices.o: E:/late/after-cap.h\n');
	assert.deepEqual(readFileSync(capturedArguments, 'utf8').split('\0').slice(0, -1), ['-Iinclude with spaces', 'C:\\sdk\\compiler-option', '@response with  spaces.rsp', '-DFIXTURE=@literal-flag', '-showIncludes', '-Zs', join(source, 'input with spaces.c').replaceAll('\\', '/')]);
	assert.equal(existsSync(join(command.cwd, 'compiled.marker')), true);
	writeFileSync(dependency, 'previous complete dependencies\n'); rmSync(join(command.cwd, 'compiled.marker'));
	const failure = spawnSync('make', [...command.args], { cwd: dirname(command.cwd), encoding: 'utf8',
		env: { ...environment, FFMPEG_DEP_FIXTURE_FAILURE: '1' } });
	assert.notEqual(failure.status, 0, 'A failing dependency compiler must stop Make before compilation.');
	assert.match(failure.stderr, /compiler-fixture-failure-sentinel/u);
	assert.doesNotMatch(failure.stderr, /compiler-diagnostic-tail-must-not-appear/u);
	assert.ok(failure.stderr.length < 17_408, 'Make receives a bounded compiler diagnostic.');
	assert.equal(existsSync(join(command.cwd, 'compiled.marker')), false);
	assert.equal(readFileSync(dependency, 'utf8'), 'previous complete dependencies\n');
	assert.deepEqual(readdirSync(dirname(dependency)).filter(name => name.includes('.pending.')), []);
	const direct = spawnSync(shell, [join(hostRoot, 'build/windows-ffmpeg-dependencies.sh'), 'libavdevice/alldevices.o', dependency,
		`@${compiler.replaceAll('\\', '/')}`, '-showIncludes', '-Zs', join(source, 'input with spaces.c')], { encoding: 'utf8',
		env: { ...environment, FFMPEG_DEP_FIXTURE_FAILURE: '1' } });
	assert.equal(direct.status, 23, 'The checked helper preserves the real compiler failure status.');
	assert.match(direct.stderr, /compiler-fixture-failure-sentinel/u);
	assert.doesNotMatch(direct.stderr, /compiler-diagnostic-tail-must-not-appear/u);
	assert.ok(direct.stderr.length <= 16_384);
	assert.equal(readFileSync(dependency, 'utf8'), 'previous complete dependencies\n');
	assert.deepEqual(readdirSync(dirname(dependency)).filter(name => name.includes('.pending.')), []);
});

test('FFmpeg build and install bypass the POSIX generated Makefile and override its source aliases', { skip: !hasTools }, context => {
	const root = mkdtempSync(join(tmpdir(), 'framescaper-ffmpeg-make-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, 'source');
	const plan = commands(root, source, shell);
	mkdirSync(source);
	writeFileSync(join(source, 'Makefile'), 'include ffbuild/config.mak\ninclude $(SRC_PATH)/feature.mk\nall install:\n\t@test -f "$(SRC_LINK)/feature.mk"\n');
	writeFileSync(join(source, 'feature.mk'), 'FEATURE_PRESENT=yes\n');
	for (const command of plan.filter(({ phase }) => ['ffmpeg-build', 'ffmpeg-install'].includes(phase))) {
		mkdirSync(join(command.cwd, 'ffbuild'), { recursive: true });
		writeFileSync(join(command.cwd, 'Makefile'), 'include /unresolvable/git-bash/ffmpeg/Makefile\n');
		writeFileSync(join(command.cwd, 'ffbuild/config.mak'), 'SRC_PATH=/unresolvable/git-bash/ffmpeg\nSRC_LINK=/unresolvable/git-bash/ffmpeg\n');
		const result = spawnSync('make', [...command.args], { cwd: dirname(command.cwd), encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
	}
});
