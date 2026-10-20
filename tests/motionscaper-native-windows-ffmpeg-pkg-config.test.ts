/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

const root = join(tmpdir(), 'motion-ffmpeg-pc-plan');
const helper = resolve(import.meta.dirname, '../native/framescaper-media-host/build/windows-ffmpeg-pkg-config.cmake');
const cmake = process.env.CMAKE ?? 'cmake';
const cmakeAvailable = spawnSync(cmake, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;

function normalize(directory: string) {
	return spawnSync(cmake, [`-DFFMPEG_PKG_CONFIG_ROOT=${directory}`, '-P', helper], { encoding: 'utf8', timeout: 5000 });
}

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
	test(`Motion ${target} normalizes only installed Windows FFmpeg pkg-config metadata before host configuration`, () => {
		const plan = commands(target);
		const adapt = plan.find(command => command.phase === 'ffmpeg-normalize-pkg-config');
		if (!target.startsWith('win-')) return assert.equal(adapt, undefined);
		assert.ok(adapt);
		const host = plan.find(command => command.phase === 'host-configure');
		assert.ok(host);
		assert.equal(adapt.executable, host.executable);
		assert.deepEqual(adapt.environment, host.environment);
		assert.equal(adapt.cwd, host.cwd);
		assert.equal(plan.indexOf(adapt), plan.findIndex(command => command.phase === 'ffmpeg-install') + 1);
		assert.equal(plan.indexOf(host), plan.indexOf(adapt) + 1);
		assert.deepEqual(adapt.args, [`-DFFMPEG_PKG_CONFIG_ROOT=${join(root, 'work/ffmpeg-install/lib/pkgconfig')}`, '-P', join(root, 'host/build/windows-ffmpeg-pkg-config.cmake')]);
	});
}

for (const newline of ['\n', '\r\n']) {
	test(`Windows FFmpeg metadata retains non-link bytes, closure order and ${newline.length === 1 ? 'LF' : 'CRLF'} line endings`, context => {
		if (!cmakeAvailable) return context.skip('CMake is unavailable');
		const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-pc-'));
		context.after(() => rmSync(directory, { recursive: true, force: true }));
		const header = ['# notice @copyright@ ${literal}; C:\\retained', 'Name: keep vpx.lib -libpath:literal', 'prefix=C:/kept path'];
		const before = ['Libs: -L${libdir} -lavcodec -libpath:"C:/codec x264.lib sources" vpx.lib opus.lib libx264.lib x265.lib advapi32.lib ole32.lib user32.lib bcrypt.lib', 'Libs.private: -libpath:\'C:/zlib opus.lib sources\' zlib.lib'];
		const after = ['Libs: -L${libdir} -lavcodec -L"C:/codec x264.lib sources" -lvpx -lopus -llibx264 -lx265 -ladvapi32 -lole32 -luser32 -lbcrypt', 'Libs.private: -L\'C:/zlib opus.lib sources\' -lzlib'];
		const footer = ['Cflags: -I${includedir}', ''];
		const original = [...header, ...before, ...footer].join(newline);
		writeFileSync(join(directory, 'libavcodec.pc'), original);
		writeFileSync(join(directory, 'libavfilter.pc'), `Name: avfilter${newline}Libs: -libpath:C:/ffmpeg avfilter.lib${newline}`);
		const result = normalize(directory);
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
		const expected = [...header, ...after, ...footer].join(newline);
		assert.equal(readFileSync(join(directory, 'libavcodec.pc'), 'utf8'), expected);
		assert.equal(readFileSync(join(directory, 'libavfilter.pc'), 'utf8'), `Name: avfilter${newline}Libs: -LC:/ffmpeg -lavfilter${newline}`);
		const again = normalize(directory);
		assert.equal(again.status, 0, `${again.stdout}${again.stderr}`);
		assert.equal(readFileSync(join(directory, 'libavcodec.pc'), 'utf8'), expected);
	});
}

test('Windows FFmpeg metadata refuses an absent, regular-file or empty metadata root', context => {
	if (!cmakeAvailable) return context.skip('CMake is unavailable');
	const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-pc-invalid-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, 'file');
	writeFileSync(file, 'retained');
	for (const invalid of [join(directory, 'absent'), file, directory]) assert.notEqual(normalize(invalid).status, 0);
	assert.equal(readFileSync(file, 'utf8'), 'retained');
});

test('MSVC links and runs the authentic codec canary through normalized CMake imported targets', context => {
	const metadata = process.env.MOTION_NATIVE_PKG_CONFIG_ROOT;
	const compiler = process.env.MOTION_NATIVE_CXX;
	const ninja = process.env.MOTION_NATIVE_NINJA;
	const pkgConfig = process.env.MOTION_NATIVE_PKG_CONFIG;
	if (process.platform !== 'win32' || !metadata || !compiler || !ninja || !pkgConfig || !cmakeAvailable) {
		return context.skip('Requires qualified Windows FFmpeg metadata/libraries and MSVC environment');
	}
	const directory = mkdtempSync(join(tmpdir(), 'motion-pc-msvc-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const pc = join(directory, 'pc');
	mkdirSync(pc);
	for (const name of readdirSync(metadata).filter(name => name.endsWith('.pc'))) copyFileSync(join(metadata, name), join(pc, name));
	const adapted = normalize(pc);
	assert.equal(adapted.status, 0, `${adapted.stdout}${adapted.stderr}`);
	copyFileSync(resolve(import.meta.dirname, '../native/framescaper-media-host/tests/codec_closure_canary.cpp'), join(directory, 'canary.cpp'));
	writeFileSync(join(directory, 'CMakeLists.txt'), [
		'cmake_minimum_required(VERSION 3.28)', 'project(authentic_windows_pkg_config LANGUAGES CXX)',
		'set(CMAKE_CXX_STANDARD 20)', 'set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded)', 'find_package(PkgConfig REQUIRED)',
		'pkg_check_modules(FFMPEG_901 REQUIRED IMPORTED_TARGET libavcodec=63.1.101 libavfilter=12.1.101 libavformat=63.1.101 libavutil=61.1.101 libswresample=7.1.101 libswscale=10.1.101)',
		'add_executable(canary canary.cpp)', 'target_link_libraries(canary PRIVATE PkgConfig::FFMPEG_901)', '',
	].join('\n'));
	const environment = { ...process.env, PKG_CONFIG_LIBDIR: pc, PKG_CONFIG_PATH: '' };
	const build = join(directory, 'build');
	const configure = spawnSync(cmake, ['-S', directory, '-B', build, '-G', 'Ninja', `-DCMAKE_CXX_COMPILER=${compiler}`, `-DCMAKE_MAKE_PROGRAM=${ninja}`, `-DPKG_CONFIG_EXECUTABLE=${pkgConfig}`, '-DCMAKE_BUILD_TYPE=Release'], { env: environment, encoding: 'utf8', timeout: 30000 });
	assert.equal(configure.status, 0, `${configure.stdout}${configure.stderr}`);
	const linked = spawnSync(cmake, ['--build', build, '--parallel', '1'], { env: environment, encoding: 'utf8', timeout: 30000 });
	assert.equal(linked.status, 0, `${linked.stdout}${linked.stderr}`);
	const run = spawnSync(join(build, 'canary.exe'), [], { encoding: 'utf8', timeout: 10000 });
	assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
	assert.deepEqual(JSON.parse(run.stdout), { components: true, x265Main10: true });
	context.diagnostic(`MSVC authentic imported-target canary: ${run.stdout.trim()}`);
});
