/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

function commands(root: string, source: string, shell: string, target = 'win-x64') {
	const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell']
		.map(role => [role, { path: role === 'shell' ? shell : `/tools/${role}` }]));
	return createFramescaperMediaHostBuildCommands({ target: { id: target, cmakePreset: target },
		hostRoot: root, ffmpegSourceRoot: source, boostSourceRoot: '/boost', paths: framescaperMediaHostBuildPaths(root),
		tools: { executables }, environment: { PATH: process.env.PATH }, configureFlags: [],
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(role => [role, source])),
	}) as readonly { phase: string; args: readonly string[]; cwd: string }[];
}

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

const shell = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/bash';
const hasTools = existsSync(shell) && spawnSync('make', ['--version']).status === 0;
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
