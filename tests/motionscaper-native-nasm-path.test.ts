/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

interface Command {
	readonly phase: string;
	readonly args: readonly string[];
	readonly environment: Readonly<Record<string, string>>;
}
const vpxPhases = new Set(['libvpx-configure', 'libvpx-build', 'libvpx-install']);
const targets = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const;
function commands(target: typeof targets[number], root: string, nasm: string, path: string): readonly Command[] {
	const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'];
	const executables = Object.fromEntries(roles.map(role => [role, { path: role === 'nasm' ? nasm
		: role === 'shell' ? 'C:/Program Files/Git/bin/bash.exe' : join(root, 'native-tools', role) }]));
	return createFramescaperMediaHostBuildCommands({ target: { id: target, cmakePreset: target }, hostRoot: join(root, 'host'),
		ffmpegSourceRoot: join(root, 'ffmpeg'), boostSourceRoot: join(root, 'boost'),
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(id => [id, join(root, 'sources', id)])),
		paths: framescaperMediaHostBuildPaths(join(root, 'work')), tools: { executables }, environment: { PATH: path }, configureFlags: [],
	}) as unknown as readonly Command[];
}

for (const target of targets) test(`Motion ${target} scopes the attested NASM search directory to libvpx commands`, () => {
	const root = join(tmpdir(), 'motion-nasm-plan'), windows = target.startsWith('win-'), x64 = target.endsWith('-x64');
	const separator = windows ? ';' : delimiter, ambient = windows ? 'C:/ambient;C:/native-tools' : '/ambient:/native-tools';
	const nasm = join(root, 'attested assembler', windows ? 'nasm.exe' : 'nasm');
	const shellPath = windows ? `C:/Program Files/Git/bin;${ambient}` : ambient;
	const plan = commands(target, root, nasm, ambient);
	for (const command of plan) {
		const expectedPath = vpxPhases.has(command.phase) && x64 ? `${dirname(nasm)}${separator}${shellPath}`
			: windows && ['libvpx-build', 'libvpx-install', 'ffmpeg-build', 'ffmpeg-install'].includes(command.phase) ? shellPath : ambient;
		assert.equal(command.environment.PATH, expectedPath, command.phase);
	}
	const configure = plan.find(command => command.phase === 'libvpx-configure')!;
	assert.equal(configure.args.includes('--as=nasm'), x64);
	assert.ok(configure.args.includes('--enable-runtime-cpu-detect'));
	assert.ok(!configure.args.includes('--disable-asm'));
});

test('Motion libvpx by-name assembler lookup executes the attested tool before a poisoned ambient NASM', { skip: process.platform === 'win32' }, context => {
	const root = mkdtempSync(join(tmpdir(), 'motion nasm lookup '));
	context.after(() => { rmSync(root, { recursive: true, force: true }); });
	const attested = join(root, 'attested assembler'), ambient = join(root, 'ambient');
	mkdirSync(attested); mkdirSync(ambient);
	const nasm = join(attested, 'nasm');
	writeFileSync(nasm, '#!/bin/sh\nprintf "attested-nasm\\n"\n', { mode: 0o755 });
	writeFileSync(join(ambient, 'nasm'), '#!/bin/sh\nprintf "ambient-nasm\\n"\n', { mode: 0o755 });
	for (const command of commands('linux-x64', root, nasm, ambient).filter(value => vpxPhases.has(value.phase))) {
		// Upstream --as=nasm replaces AS with a bare command; exercise that real shell lookup.
		const output = execFileSync('/bin/sh', ['-c', 'command -v nasm; nasm'], {
			env: { ...command.environment }, encoding: 'utf8', timeout: 5_000, maxBuffer: 65_536,
		});
		assert.deepEqual(output.trimEnd().split('\n'), [nasm, 'attested-nasm'], command.phase);
	}
});
