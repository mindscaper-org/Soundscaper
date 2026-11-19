/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shell = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/bash';
const hasTools = existsSync(shell) && spawnSync('make', ['--version']).status === 0;

test('Windows libvpx keeps its upstream source list outside the process command and preserves vendor paths and options', { skip: !hasTools }, context => {
	const root = mkdtempSync(join(tmpdir(), 'framescaper-vpx-response-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, 'vendor with spaces');
	mkdirSync(join(source, 'build/make'), { recursive: true });
	const capture = join(root, 'captured.txt');
	writeFileSync(join(source, 'build/make/common.sh'), 'marker=vendor-context\n');
	writeFileSync(join(source, 'build/make/gen_msvs_vcxproj.sh'), '#!/bin/bash\nsource "${0%/*}/common.sh"\nprintf "%s\\0" "$marker" "$@" > "$CAPTURE"\n');
	const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell']
		.map(role => [role, { path: role === 'shell' ? shell : `/tools/${role}` }]));
	const commands = createFramescaperMediaHostBuildCommands({ target: { id: 'win-arm64', cmakePreset: 'win-arm64' },
		hostRoot: join(repository, 'native/framescaper-media-host'), ffmpegSourceRoot: '/ffmpeg', boostSourceRoot: '/boost',
		paths: framescaperMediaHostBuildPaths(root), tools: { executables }, environment: { PATH: process.env.PATH }, configureFlags: [],
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(role => [role, source])),
	}) as readonly { phase: string; args: readonly string[] }[];
	const buildArgs = commands.find(command => command.phase === 'libvpx-build')!.args;
	const generator = buildArgs.find(value => value.startsWith('GEN_VCPROJ='));
	assert.ok(generator, 'The Windows generator must use a response file, rather than a long command line.');
	const variables = buildArgs.filter(value => /^(?:GEN_VCPROJ|VCPROJ_SRCS)=/u.test(value));
	const sources = Array.from({ length: 1000 }, (_, index) => `vpx_dsp/source_${String(index)}.c`);
	const header = join(root, 'vp8.h');
	const installedHeader = join(root, 'install/include/vpx/vp8.h').replaceAll('\\', '/');
	writeFileSync(header, 'the authenticated vendor header\n');
	const makefile = join(root, 'probe.mk');
	writeFileSync(makefile, `ifeq ($(target),)\nall second.vcxproj install:\n\t$(MAKE) --no-print-directory -f "$(lastword $(MAKEFILE_LIST))" target=libs $(MAKECMDGOALS)\nelse\nall: result.vcxproj\n.PHONY: ${sources.join(' ')}\nASM_INCLUDES=excluded.asm\nresult.vcxproj: VCPROJ_SRCS = $(filter-out $(addprefix %, $(ASM_INCLUDES)), $^)\nresult.vcxproj: ${sources.join(' ')} excluded.asm\n\t$(GEN_VCPROJ) --lib --name=vpx -I. -I"include with spaces" $(filter vpx_dsp/%.c, $(VCPROJ_SRCS))\n.PHONY: excluded.asm\nsecond.vcxproj: ${sources.at(-1)} ${sources[0]}\n\t$(GEN_VCPROJ) --lib --name=second $(VCPROJ_SRCS)\ninstall: ${installedHeader}\n${installedHeader}: ${header.replaceAll('\\', '/')}\n\tmkdir -p "$(@D)"\n\tcp "$<" "$@"\nendif\n`);
	const makeArgs = ['-f', makefile, ...variables, `SHELL=${shell}`, '.SHELLFLAGS=-e -c'];
	const dryRun = spawnSync('make', ['-n', ...makeArgs], { cwd: root, encoding: 'utf8' });
	assert.equal(dryRun.status, 0, dryRun.stderr);
	assert.ok(dryRun.stdout.length < 2048, 'The complete project command must fit before the response wrapper starts.');
	assert.doesNotMatch(dryRun.stdout, /vpx_dsp\/source_/u);
	const result = spawnSync('make', makeArgs, {
		cwd: root, encoding: 'utf8', env: { ...process.env, CAPTURE: capture },
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(readFileSync(capture, 'utf8').split('\0').slice(0, -1), ['vendor-context', '--lib', '--name=vpx', '-I.', '-Iinclude with spaces', ...sources]);
	const firstResponse = readFileSync(join(root, 'result.vcxproj.sources'), 'utf8');
	const second = spawnSync('make', [...makeArgs, 'second.vcxproj'], {
		cwd: root, encoding: 'utf8', env: { ...process.env, CAPTURE: capture },
	});
	assert.equal(second.status, 0, second.stderr);
	assert.deepEqual(readFileSync(capture, 'utf8').split('\0').slice(0, -1), ['vendor-context', '--lib', '--name=second', sources.at(-1), sources[0]]);
	assert.equal(readFileSync(join(root, 'result.vcxproj.sources'), 'utf8'), firstResponse,
		'A later project must not replace the first project response file.');
	assert.equal(existsSync(dirname(installedHeader)), false, 'Installation starts with no nested destination directory.');
	const install = spawnSync('make', [...makeArgs, 'install'], {
		cwd: root, encoding: 'utf8', env: { ...process.env, CAPTURE: capture },
	});
	assert.equal(install.status, 0, install.stdout + install.stderr);
	assert.equal(readFileSync(installedHeader, 'utf8'), 'the authenticated vendor header\n');
	assert.equal(existsSync(`${installedHeader}.sources`), false, 'Header installation must not capture a project response.');
	assert.equal(existsSync(join(root, 'install.sources')), false, 'The recursive install target must not capture a project response.');
	const response = join(root, 'windows.sources');
	writeFileSync(response, `${sources.join(' ')}\r\n`);
	const wrapped = spawnSync(shell, [join(repository, 'native/framescaper-media-host/build/windows-vpx-project.sh'),
		join(source, 'build/make/gen_msvs_vcxproj.sh'), response, '--lib', 'truncated/source.c'], {
		encoding: 'utf8', env: { ...process.env, CAPTURE: capture },
	});
	assert.equal(wrapped.status, 0, wrapped.stderr);
	assert.deepEqual(readFileSync(capture, 'utf8').split('\0').slice(0, -1), ['vendor-context', '--lib', ...sources]);
});
