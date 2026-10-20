/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

interface Command {
	readonly phase: string;
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly environment: Readonly<Record<string, string>>;
}

const root = join(tmpdir(), 'motion-zlib-plan');
const helper = resolve(import.meta.dirname, '../native/framescaper-media-host/build/windows-zlib-config.cmake');
const directive = '#ifdef HAVE_UNISTD_H    /* may be set to #if 1 by ./configure */';
const corrected = '#if defined(HAVE_UNISTD_H) && (HAVE_UNISTD_H + 0) /* Soundscaper Windows adaptation: honor numeric feature macros. */    /* may be set to #if 1 by ./configure */';
const cmake = process.env.CMAKE ?? 'cmake';
const cmakeAvailable = spawnSync(cmake, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;

function commands(target: string): readonly Command[] {
	const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'];
	return createFramescaperMediaHostBuildCommands({
		target: { id: target, cmakePreset: target }, hostRoot: join(root, 'host'),
		ffmpegSourceRoot: join(root, 'ffmpeg'), boostSourceRoot: join(root, 'boost'),
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'libopus', 'zlib'].map(id => [id, join(root, id)])),
		paths: framescaperMediaHostBuildPaths(join(root, 'work')),
		tools: { executables: Object.fromEntries(roles.map(role => [role, { path: join(root, 'tools', role) }])) },
		environment: { PATH: join(root, 'tools'), SOURCE_DATE_EPOCH: '1786492800' }, configureFlags: [],
	}) as unknown as readonly Command[];
}

for (const target of ['win-x64', 'win-arm64', 'linux-x64', 'linux-arm64', 'mac-arm64']) {
	test(`Motion ${target} normalizes only the installed Windows zlib configuration before FFmpeg`, () => {
		const plan = commands(target);
		const normalize = plan.find(command => command.phase === 'zlib-normalize-config');
		if (!target.startsWith('win-')) return assert.equal(normalize, undefined);
		assert.ok(normalize);
		const install = plan.find(command => command.phase === 'zlib-install-metadata');
		assert.ok(install);
		assert.equal(normalize.executable, install.executable);
		assert.deepEqual(normalize.environment, install.environment);
		assert.equal(normalize.cwd, install.cwd);
		assert.equal(plan.indexOf(normalize), plan.indexOf(install) + 1);
		assert.ok(plan.indexOf(normalize) < plan.findIndex(command => command.phase === 'ffmpeg-configure'));
		assert.deepEqual(normalize.args, [
			`-DZLIB_CONFIG_HEADER=${join(root, 'work/zlib-install/include/zconf.h')}`,
			'-P', join(root, 'host/build/windows-zlib-config.cmake'),
		]);
	});
}

for (const newline of ['\n', '\r\n']) {
	test(`Windows zlib normalization preserves header bytes around its ${newline.length === 1 ? 'LF' : 'CRLF'} directive`, context => {
		if (!cmakeAvailable) return context.skip('CMake is unavailable');
		const directory = mkdtempSync(join(tmpdir(), 'motion-zlib-config-'));
		context.after(() => rmSync(directory, { recursive: true, force: true }));
		const header = join(directory, 'zconf.h');
		const original = ['/* retained notice @copyright@ */', directive, '# define Z_HAVE_UNISTD_H', '#endif', ''].join(newline);
		writeFileSync(header, original);
		const result = spawnSync(cmake, [`-DZLIB_CONFIG_HEADER=${header}`, '-P', helper], { encoding: 'utf8', timeout: 5000 });
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
		assert.equal(readFileSync(header, 'utf8'), original.replace(directive, corrected));
	});
}

test('Windows zlib normalization refuses missing or repeated upstream directives without changing the file', context => {
	if (!cmakeAvailable) return context.skip('CMake is unavailable');
	const directory = mkdtempSync(join(tmpdir(), 'motion-zlib-invalid-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const header = join(directory, 'zconf.h');
	for (const original of ['/* unexpected upstream header */\n', `${directive}\n${directive}\n`]) {
		writeFileSync(header, original);
		const result = spawnSync(cmake, [`-DZLIB_CONFIG_HEADER=${header}`, '-P', helper], { encoding: 'utf8', timeout: 5000 });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /unique upstream HAVE_UNISTD_H\s+directive/u);
		assert.equal(readFileSync(header, 'utf8'), original);
	}
});

test('MSVC compiles the authentic installed zlib header with FFmpeg numeric feature macros', context => {
	const headers = process.env.MOTION_NATIVE_ZLIB_HEADER_SOURCE_ROOT;
	const compiler = process.env.MOTION_NATIVE_ZLIB_CC;
	if (process.platform !== 'win32' || !headers || !compiler || !cmakeAvailable) {
		return context.skip('Requires the qualified Windows zlib headers and MSVC environment');
	}
	const directory = mkdtempSync(join(tmpdir(), 'motion-zlib-msvc-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	for (const name of ['zlib.h', 'zconf.h']) copyFileSync(join(headers, name), join(directory, name));
	const header = join(directory, 'zconf.h');
	const original = readFileSync(header, 'utf8');
	const compile = (macro: string, name: string) => {
		const source = join(directory, `${name}.c`);
		writeFileSync(source, `${macro}\n#include "zlib.h"\nint probe(void) { z_stream stream = {0}; return (int)stream.avail_in; }\n`);
		return spawnSync(compiler, ['/nologo', '/c', '/std:c17', `/I${directory}`, `/Fo${join(directory, `${name}.obj`)}`, source], { encoding: 'utf8', timeout: 5000 });
	};
	const red = compile('#define HAVE_UNISTD_H 0', 'original-zero');
	assert.equal(red.error, undefined);
	assert.notEqual(red.status, 0);
	assert.match(`${red.stdout}${red.stderr}`, /fatal error C1083:[\s\S]*unistd\.h/u);
	context.diagnostic(`MSVC original HAVE_UNISTD_H=0 exit ${String(red.status)}: ${red.stdout}${red.stderr}`);
	const normalize = spawnSync(cmake, [`-DZLIB_CONFIG_HEADER=${header}`, '-P', helper], { encoding: 'utf8', timeout: 5000 });
	assert.equal(normalize.status, 0, `${normalize.stdout}${normalize.stderr}`);
	assert.equal(readFileSync(header, 'utf8'), original.replace(directive, corrected));
	const green = compile('#define HAVE_UNISTD_H 0', 'adapted-zero');
	assert.equal(green.status, 0, `${green.stdout}${green.stderr}`);
	context.diagnostic('MSVC adapted HAVE_UNISTD_H=0 exit 0');
	writeFileSync(join(directory, 'unistd.h'), '#error EXPECTED_UNISTD_INCLUDE\n');
	const unset = compile('', 'adapted-unset');
	assert.equal(unset.status, 0, `${unset.stdout}${unset.stderr}`);
	const enabled = compile('#define HAVE_UNISTD_H 1', 'adapted-one');
	assert.equal(enabled.error, undefined);
	assert.notEqual(enabled.status, 0);
	assert.match(`${enabled.stdout}${enabled.stderr}`, /EXPECTED_UNISTD_INCLUDE/u);
});
