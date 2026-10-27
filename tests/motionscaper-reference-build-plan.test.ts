/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionReferenceCompilePlan } from '../scripts/lib/motionscaper-reference-build-plan.ts';

test('native MSVC reference plan retains spaced paths as literal argv and selects the actual ARM64 toolchain', () => {
	const plan = createMotionReferenceCompilePlan({ target: 'win-arm64', repositoryRoot: 'C:\\source checkout', directory: 'C:\\owned output',
		installRoots: ['C:\\native work\\ffmpeg-install'], tools: { cmake: 'C:\\tools space\\cmake.exe', ninja: 'C:\\tools space\\ninja.exe',
			c: 'C:\\VS tools\\cl.exe', cxx: 'C:\\VS tools\\cl.exe', pkgConfig: 'C:\\tools space\\pkg-config.exe', rc: 'C:\\SDK tools\\rc.exe' } });
	assert.equal(plan.decoder, 'C:\\owned output\\motion-reference-decoder.exe');
	assert.deepEqual(plan.commands[0]?.args.slice(0, 6), ['-S', 'C:\\source checkout\\scripts\\lib\\motionscaper-reference-native', '-B', 'C:\\owned output\\reference-build', '--fresh', '-G']);
	assert.ok(plan.commands[0]?.args.includes('Ninja Multi-Config'));
	assert.ok(plan.commands[0]?.args.includes('-DCMAKE_TOOLCHAIN_FILE=C:\\source checkout\\native\\framescaper-media-host\\build\\toolchains\\win-arm64.cmake'));
	assert.ok(plan.commands[0]?.args.includes('-DFRAMESCAPER_CXX_COMPILER=C:\\VS tools\\cl.exe'));
	assert.ok(plan.commands[0]?.args.includes('-DCMAKE_RC_COMPILER=C:\\SDK tools\\rc.exe'));
	assert.ok(plan.commands[0]?.args.includes('-DMOTION_REFERENCE_LIBRARY_DIRECTORIES=C:\\native work\\ffmpeg-install\\lib'));
	assert.deepEqual(plan.commands[1]?.args, ['--build', 'C:\\owned output\\reference-build', '--config', 'Release', '--target', 'motion-reference-decoder', '--parallel', '1']);
	assert.ok(plan.commands.every(command => command.executable === 'C:\\tools space\\cmake.exe'));
});

test('Linux and macOS reference plans preserve native CMake tools, independent source and one compile budget', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64'] as const) {
		const plan = createMotionReferenceCompilePlan({ target, repositoryRoot: '/source', directory: '/owned', installRoots: ['/native/ffmpeg-install'],
			tools: { cmake: '/tools/cmake', ninja: '/tools/ninja', c: '/tools/cc', cxx: '/tools/c++', pkgConfig: '/tools/pkg-config' } });
		assert.equal(plan.decoder, '/owned/motion-reference-decoder'); assert.equal(plan.compileBudgetMs, 60_000);
		assert.ok(plan.commands[0]?.args.includes('Ninja'));
		assert.ok(plan.commands[0]?.args.includes(`-DCMAKE_TOOLCHAIN_FILE=/source/native/framescaper-media-host/build/toolchains/${target}.cmake`));
		assert.equal(plan.commands.length, 2);
	}
});

test('reference plans refuse CMake-list injection and noncanonical path arguments before compiling', () => {
	const input = { target: 'linux-x64' as const, repositoryRoot: '/source', directory: '/owned', installRoots: ['/native/ffmpeg-install'],
		tools: { cmake: '/tools/cmake', ninja: '/tools/ninja', c: '/tools/cc', cxx: '/tools/c++', pkgConfig: '/tools/pkg-config' } };
	for (const directory of ['relative', '/owned/../other', '/owned;injected', '/owned\nother']) assert.throws(() => createMotionReferenceCompilePlan({ ...input, directory }), /path/u);
	assert.throws(() => createMotionReferenceCompilePlan({ ...input, installRoots: [] }), /install/u);
});
