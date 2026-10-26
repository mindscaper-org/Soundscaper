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

test('Windows libvpx generation preserves a complete CRLF response file and vendor script context', { skip: !hasTools }, context => {
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
	const generator = commands.find(command => command.phase === 'libvpx-build')!.args.find(value => value.startsWith('GEN_VCPROJ='));
	assert.ok(generator, 'The Windows generator must use a response file, rather than a long command line.');
	const sources = Array.from({ length: 1000 }, (_, index) => `vpx_dsp/source_${String(index)}.c`);
	const makefile = join(root, 'probe.mk');
	writeFileSync(makefile, `all: result.vcxproj\nresult.vcxproj: VCPROJ_SRCS = ${sources.join(' ')}\nresult.vcxproj:\n\t$(GEN_VCPROJ) --lib --name=vpx -I. truncated/source.c\n`);
	const result = spawnSync('make', ['-f', makefile, generator, `SHELL=${shell}`, '.SHELLFLAGS=-e -c'], {
		cwd: root, encoding: 'utf8', env: { ...process.env, CAPTURE: capture },
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(readFileSync(capture, 'utf8').split('\0').slice(0, -1), ['vendor-context', '--lib', '--name=vpx', '-I.', ...sources]);
	const response = join(root, 'windows.sources');
	writeFileSync(response, `${sources.join(' ')}\r\n`);
	const wrapped = spawnSync(shell, [join(repository, 'native/framescaper-media-host/build/windows-vpx-project.sh'),
		join(source, 'build/make/gen_msvs_vcxproj.sh'), response, '--lib', 'truncated/source.c'], {
		encoding: 'utf8', env: { ...process.env, CAPTURE: capture },
	});
	assert.equal(wrapped.status, 0, wrapped.stderr);
	assert.deepEqual(readFileSync(capture, 'utf8').split('\0').slice(0, -1), ['vendor-context', '--lib', ...sources]);
});
