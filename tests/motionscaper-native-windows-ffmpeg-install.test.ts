/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

type Target = 'win-x64' | 'win-arm64' | 'linux-x64' | 'linux-arm64' | 'mac-arm64';
interface Command {
	readonly phase: string;
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly environment: Readonly<Record<string, string>>;
}
const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'];
const phases = ['ffmpeg-build', 'ffmpeg-install'] as const;
const portable = (path: string): string => path.replaceAll('\\', '/');
const digest = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');

function plan(target: Target, work: string, source: string, make = 'make', shell = '/bin/bash'): readonly Command[] {
	const executables = Object.fromEntries(roles.map(role => [role, {
		path: role === 'make' ? make : role === 'shell' ? shell : join(work, 'tools', role),
	}]));
	return createFramescaperMediaHostBuildCommands({
		target: { id: target, cmakePreset: target }, hostRoot: join(work, 'host'),
		ffmpegSourceRoot: source, boostSourceRoot: join(work, 'boost'),
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(id => [id, join(work, id)])),
		paths: framescaperMediaHostBuildPaths(work), tools: { executables },
		environment: { PATH: process.env.PATH ?? '' }, configureFlags: [],
	}) as unknown as readonly Command[];
}
function phase(commands: readonly Command[], name: string): Command {
	const command = commands.find(candidate => candidate.phase === name);
	assert.ok(command, `Missing ${name}`);
	return command;
}

for (const target of ['win-x64', 'win-arm64'] as const) {
	test(`Motion ${target} FFmpeg Make uses its authenticated relative source copy`, () => {
		const source = 'C:/external-cache/ffmpeg-source';
		for (const name of phases) {
			const command = phase(plan(target, 'D:/native-work', source), name);
			assert.deepEqual(command.args.filter(argument => /^(?:SRC_PATH|SRC_LINK)=/u.test(argument)), ['SRC_PATH=src', 'SRC_LINK=src']);
			assert.ok(command.args.includes(`${source}/Makefile`));
		}
	});
}
for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64'] as const) {
	test(`Motion ${target} FFmpeg Make retains its original arguments`, () => {
		const work = join(tmpdir(), 'motion-install-plan');
		const commands = plan(target, work, join(work, 'source'));
		const build = framescaperMediaHostBuildPaths(work).ffmpegBuild as string;
		assert.deepEqual(phase(commands, 'ffmpeg-build').args, ['-C', build, '-j1']);
		assert.deepEqual(phase(commands, 'ffmpeg-install').args, ['-C', build, 'install']);
	});
}

test('Motion quiet FFmpeg header installation completes through real native Make and Bash', context => {
	const windows = process.platform === 'win32';
	const make = windows ? process.env.FRAMESCAPER_MEDIA_MAKE : 'make';
	const shell = windows ? process.env.FRAMESCAPER_MEDIA_SHELL : '/bin/bash';
	if (windows && (process.arch !== 'x64' || !make || !shell)) {
		return context.skip('Windows x64 fixture requires explicit FRAMESCAPER_MEDIA_MAKE and FRAMESCAPER_MEDIA_SHELL');
	}
	assert.ok(make && shell, 'Windows requires FRAMESCAPER_MEDIA_MAKE and FRAMESCAPER_MEDIA_SHELL');
	if (!windows && (!existsSync(shell) || spawnSync(make, ['--version'], { timeout: 5000 }).status !== 0)) {
		return context.skip('GNU Make and Bash are required for the baseline fixture');
	}
	if (windows) {
		assert.equal(process.arch, 'x64');
		assert.ok(isAbsolute(make) && isAbsolute(shell));
		assert.equal(basename(make).toLowerCase(), 'mingw32-make.exe');
		assert.equal(basename(shell).toLowerCase(), 'bash.exe');
		assert.ok(portable(dirname(shell)).toLowerCase().endsWith('/git/usr/bin'), 'Use direct Git usr/bin/bash.exe');
		for (const executable of [make, shell]) assert.ok(lstatSync(executable).isFile() && !lstatSync(executable).isSymbolicLink());
	}
	const root = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-install-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, 'external-cache', 'ffmpeg-9.0.1-source');
	const work = join(root, 'work');
	const paths = framescaperMediaHostBuildPaths(work);
	const build = paths.ffmpegBuild as string;
	const destination = join(paths.ffmpegInstall as string, 'include', 'libavutil');
	const headers = Array.from({ length: 100 }, (_, index) => `header_${String(index).padStart(3, '0')}.h`);
	const generated = ['avconfig.h', 'ffversion.h'];
	const expected = new Map(headers.map(name => [name, Buffer.from(`/* authenticated source ${name} */\n`)]));
	const externalArguments = headers.map(name => portable(join(source, 'libavutil', name))).join(' ');
	assert.ok(Buffer.byteLength(`printf "INSTALL\\t%s\\n" ${externalArguments}`) > 8191, 'Exercise the observed native Make truncation boundary');
	mkdirSync(join(source, 'libavutil'), { recursive: true });
	for (const [name, body] of expected) writeFileSync(join(source, 'libavutil', name), body);
	const makefile = [
		'include ffbuild/config.mak', 'vpath %.h $(SRC_PATH)', 'INSTALL=install',
		'ifndef V', 'Q = @', 'ECHO = printf "$(1)\\t%s\\n" $(2)',
		'$(eval INSTALL = @$(call ECHO,INSTALL,$$(^:$(SRC_DIR)/%=%)); $(INSTALL))', 'endif',
		`HEADERS = ${headers.join(' ')}`, `BUILT_HEADERS = ${generated.join(' ')}`,
		`INCINSTDIR = ${portable(destination)}`,
		'all:\n\t@test -f "$(SRC_LINK)/libavutil/header_000.h"',
		'install: install-libavutil-headers',
		'install-libavutil-headers: $(addprefix libavutil/,$(HEADERS) $(BUILT_HEADERS))',
		'\t$(Q)mkdir -p "$(INCINSTDIR)"',
		'\t$(INSTALL) -m 644 $^ "$(INCINSTDIR)"',
		'\t@printf "complete\\n" > install-tail-marker', '',
	].join('\n');
	writeFileSync(join(source, 'Makefile'), makefile);
	mkdirSync(build, { recursive: true });
	cpSync(source, join(build, 'src'), { recursive: true, errorOnExist: true, force: false });
	assert.equal(digest(readFileSync(join(build, 'src', 'Makefile'))), digest(Buffer.from(makefile)));
	assert.deepEqual(readdirSync(join(build, 'src', 'libavutil')).sort(), headers);
	for (const [name, body] of expected) assert.equal(digest(readFileSync(join(build, 'src', 'libavutil', name))), digest(body));
	mkdirSync(join(build, 'libavutil'));
	for (const name of generated) {
		const body = Buffer.from(`/* generated build ${name} */\n`);
		expected.set(name, body); writeFileSync(join(build, 'libavutil', name), body);
	}
	mkdirSync(join(build, 'ffbuild'));
	writeFileSync(join(build, 'ffbuild', 'config.mak'), 'SRC_PATH=/unresolvable/source\nSRC_LINK=/unresolvable/source\n');
	writeFileSync(join(build, 'Makefile'), 'include /unresolvable/source/Makefile\n');
	const commands = plan('win-x64', work, source, make, shell);
	for (const name of phases) {
		const command = phase(commands, name);
		const result = spawnSync(command.executable, [...command.args], {
			cwd: command.cwd, env: windows ? { ...process.env, ...command.environment } : process.env,
			encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true,
		});
		assert.ifError(result.error);
		assert.equal(result.signal, null);
		assert.equal(result.status, 0, `${name}: ${result.stderr}\n${result.stdout}`);
	}
	for (const [name, body] of expected) {
		const installed = join(destination, name);
		assert.ok(existsSync(installed), `Missing installed ${name}`);
		assert.deepEqual(readFileSync(installed), body, `Installed ${name} differs from its admitted source`);
	}
	assert.deepEqual(readdirSync(destination).sort(), [...expected.keys()].sort());
	assert.equal(readFileSync(join(build, 'install-tail-marker'), 'utf8'), 'complete\n');
});
