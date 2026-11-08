/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import test from 'node:test';
import { createMotionReferenceCompilePlan } from '../scripts/lib/motionscaper-reference-build-plan.ts';

const cmake = process.env.FRAMESCAPER_MEDIA_CMAKE || 'cmake';
const probe = spawnSync(cmake, ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
const unavailable = !process.env.FRAMESCAPER_MEDIA_CMAKE && (probe.error !== undefined || probe.status !== 0);
const installNames = ['ffmpeg-install', 'x264-install', 'x265-install', 'libvpx-install', 'svt-av1-install', 'libopus-install', 'zlib-install'];

for (const target of ['win-x64', 'win-arm64'] as const) {
	test(`reference ${target} paths survive the real CMake resource-compiler template`, { skip: unavailable ? 'CMake is unavailable' : false }, () => {
		assert.ifError(probe.error); assert.equal(probe.status, 0, probe.stderr);
		const input = { target, repositoryRoot: 'C:\\source checkout', directory: 'C:\\owned output',
			installRoots: installNames.map(name => win32.join('C:\\native work\\media-build', name)),
			tools: { cmake: 'C:\\tools space\\cmake.exe', ninja: 'C:\\tools space\\ninja.exe', c: 'C:\\VS tools\\cl.exe',
				cxx: 'C:\\VS tools\\cl.exe', pkgConfig: 'C:\\tools space\\pkgconf.exe',
				rc: 'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\rc.exe' } };
		const plan = createMotionReferenceCompilePlan(input);
		const expected = {
			CMAKE_TOOLCHAIN_FILE: `C:/source checkout/native/framescaper-media-host/build/toolchains/${target}.cmake`,
			CMAKE_MAKE_PROGRAM: 'C:/tools space/ninja.exe', FRAMESCAPER_C_COMPILER: 'C:/VS tools/cl.exe',
			FRAMESCAPER_CXX_COMPILER: 'C:/VS tools/cl.exe', PKG_CONFIG_EXECUTABLE: 'C:/tools space/pkgconf.exe',
			CMAKE_RC_COMPILER: 'C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/rc.exe',
			MOTION_REFERENCE_OUTPUT_DIRECTORY: 'C:/owned output',
			MOTION_REFERENCE_INCLUDE_DIRECTORIES: installNames.map(name => `C:/native work/media-build/${name}/include`).join(';'),
			MOTION_REFERENCE_LIBRARY_DIRECTORIES: installNames.map(name => `C:/native work/media-build/${name}/lib`).join(';'),
		};
		const directory = mkdtempSync(join(tmpdir(), 'motion-reference-cmake-paths-'));
		try {
			const script = join(directory, 'round-trip.cmake');
			// Exercise CMake's own generated RC file, whose quoted literal rejects raw \P.
			writeFileSync(script, [
				'cmake_minimum_required(VERSION 3.28)',
				'configure_file("${CMAKE_ROOT}/Modules/CMakeRCCompiler.cmake.in" "${CMAKE_CURRENT_LIST_DIR}/CMakeRCCompiler.cmake" @ONLY)',
				'include("${CMAKE_CURRENT_LIST_DIR}/CMakeRCCompiler.cmake")',
				`foreach(name IN ITEMS ${Object.keys(expected).join(' ')})`,
				'  file(APPEND "${CMAKE_CURRENT_LIST_DIR}/observed.txt" "${name}=${${name}}\\n")',
				'endforeach()',
			].join('\n'));
			const definitions = plan.commands[0]!.args.filter(argument => argument.startsWith('-D'));
			const run = spawnSync(cmake, [...definitions, '-P', script], {
				cwd: directory, encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true,
			});
			assert.ifError(run.error); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr);
			assert.deepEqual(readFileSync(join(directory, 'observed.txt'), 'utf8').trimEnd().split(/\r?\n/u),
				Object.entries(expected).map(([name, value]) => `${name}=${value}`));
			assert.equal(plan.commands[0]!.executable, input.tools.cmake);
			assert.equal(plan.commands[0]!.cwd, input.repositoryRoot);
			assert.equal(plan.commands[1]!.args[1], 'C:\\owned output\\reference-build');
			assert.equal(plan.decoder, 'C:\\owned output\\motion-reference-decoder.exe');
			assert.equal(plan.compileBudgetMs, 60_000);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});
}
