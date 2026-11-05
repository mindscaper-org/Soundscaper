/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { posix, win32 } from 'node:path';
import { createMotionReferenceCompileEnvironment, createMotionReferenceCompilePlan } from '../scripts/lib/motionscaper-reference-build-plan.ts';
import type { MotionNativeTarget } from '../scripts/lib/motionscaper-native-source.ts';

const installNames = ['ffmpeg-install', 'x264-install', 'x265-install', 'libvpx-install', 'svt-av1-install', 'libopus-install', 'zlib-install'];
const roots = (parent: string, windows = false) => installNames.map(name => (windows ? win32 : posix).join(parent, name));

test('native MSVC reference plan retains spaced paths as literal argv and selects the actual ARM64 toolchain', () => {
	const plan = createMotionReferenceCompilePlan({ target: 'win-arm64', repositoryRoot: 'C:\\source checkout', directory: 'C:\\owned output',
		installRoots: roots('C:\\native work', true), tools: { cmake: 'C:\\tools space\\cmake.exe', ninja: 'C:\\tools space\\ninja.exe',
			c: 'C:\\VS tools\\cl.exe', cxx: 'C:\\VS tools\\cl.exe', pkgConfig: 'C:\\tools space\\pkg-config.exe', rc: 'C:\\SDK tools\\rc.exe' } });
	assert.equal(plan.decoder, 'C:\\owned output\\motion-reference-decoder.exe');
	assert.deepEqual(plan.commands[0]?.args.slice(0, 6), ['-S', 'C:\\source checkout\\scripts\\lib\\motionscaper-reference-native', '-B', 'C:\\owned output\\reference-build', '--fresh', '-G']);
	assert.ok(plan.commands[0]?.args.includes('Ninja Multi-Config'));
	assert.ok(plan.commands[0]?.args.includes('-DCMAKE_TOOLCHAIN_FILE=C:/source checkout/native/framescaper-media-host/build/toolchains/win-arm64.cmake'));
	assert.ok(plan.commands[0]?.args.includes('-DFRAMESCAPER_CXX_COMPILER=C:/VS tools/cl.exe'));
	assert.ok(plan.commands[0]?.args.includes('-DCMAKE_RC_COMPILER=C:/SDK tools/rc.exe'));
	assert.ok(plan.commands[0]?.args.includes(`-DMOTION_REFERENCE_LIBRARY_DIRECTORIES=${roots('C:\\native work', true).map(root => win32.join(root, 'lib').replaceAll('\\', '/')).join(';')}`));
	assert.deepEqual(plan.commands[1]?.args, ['--build', 'C:\\owned output\\reference-build', '--config', 'Release', '--target', 'motion-reference-decoder', '--parallel', '1']);
	assert.ok(plan.commands.every(command => command.executable === 'C:\\tools space\\cmake.exe'));
});

test('Linux and macOS reference plans preserve native CMake tools, independent source and one compile budget', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64'] as const) {
		const plan = createMotionReferenceCompilePlan({ target, repositoryRoot: '/source', directory: '/owned', installRoots: roots('/native'),
			tools: { cmake: '/tools/cmake', ninja: '/tools/ninja', c: '/tools/cc', cxx: '/tools/c++', pkgConfig: '/tools/pkg-config' } });
		assert.equal(plan.decoder, '/owned/motion-reference-decoder'); assert.equal(plan.compileBudgetMs, 60_000);
		assert.ok(plan.commands[0]?.args.includes('Ninja'));
		assert.ok(plan.commands[0]?.args.includes(`-DCMAKE_TOOLCHAIN_FILE=/source/native/framescaper-media-host/build/toolchains/${target}.cmake`));
		assert.equal(plan.commands.length, 2);
	}
});

test('reference plans refuse CMake-list injection and noncanonical path arguments before compiling', () => {
	const input = { target: 'linux-x64' as const, repositoryRoot: '/source', directory: '/owned', installRoots: roots('/native'),
		tools: { cmake: '/tools/cmake', ninja: '/tools/ninja', c: '/tools/cc', cxx: '/tools/c++', pkgConfig: '/tools/pkg-config' } };
	for (const directory of ['relative', '/owned/../other', '/owned;injected', '/owned\nother']) assert.throws(() => createMotionReferenceCompilePlan({ ...input, directory }), /path/u);
	assert.throws(() => createMotionReferenceCompilePlan({ ...input, installRoots: [] }), /install/u);
});

for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const) {
	test(`reference compiler admits the complete SVT-AV1 static closure on ${target}`, () => {
		const windows = target.startsWith('win-'), path = windows ? win32 : posix;
		const parent = windows ? 'C:\\native work\\media-build' : '/native/media-build';
		const installRoots = roots(parent, windows);
		const tool = (name: string) => windows ? `C:\\tools\\${name}.exe` : `/tools/${name}`;
		const input = { target, repositoryRoot: windows ? 'C:\\source' : '/source', directory: windows ? 'C:\\owned' : '/owned', installRoots,
			tools: { cmake: tool('cmake'), ninja: tool('ninja'), c: tool('cc'), cxx: tool('cxx'), pkgConfig: tool('pkg-config'), ...(windows ? { rc: tool('rc') } : {}) } };
		const plan = createMotionReferenceCompilePlan(input);
		assert.equal(plan.compileBudgetMs, 60_000);
		const cmakePath = (value: string) => windows ? value.replaceAll('\\', '/') : value;
		assert.ok(plan.commands[0]!.args.includes(`-DMOTION_REFERENCE_INCLUDE_DIRECTORIES=${installRoots.map(root => cmakePath(path.join(root, 'include'))).join(';')}`));
		assert.ok(plan.commands[0]!.args.includes(`-DMOTION_REFERENCE_LIBRARY_DIRECTORIES=${installRoots.map(root => cmakePath(path.join(root, 'lib'))).join(';')}`));
		const environment = createMotionReferenceCompileEnvironment({ PATH: '/tools', PKG_CONFIG_PATH: '/ambient', NODE_V8_COVERAGE: '/ambient-coverage' }, installRoots, target);
		assert.equal(environment.PKG_CONFIG_LIBDIR, installRoots.flatMap(root => [path.join(root, 'lib/pkgconfig'), path.join(root, 'share/pkgconfig')]).join(windows ? ';' : ':'));
		assert.equal(environment.PKG_CONFIG_PATH, ''); assert.equal(environment.PKG_CONFIG_SYSROOT_DIR, ''); assert.equal(environment.NODE_V8_COVERAGE, undefined);
	});
}

test('reference compiler refuses a missing SVT-AV1 prefix instead of relying on ambient libraries', () => {
	const installRoots = roots('/native').filter(root => !root.endsWith('/svt-av1-install'));
	const input = { target: 'linux-x64' as MotionNativeTarget, repositoryRoot: '/source', directory: '/owned', installRoots,
		tools: { cmake: '/tools/cmake', ninja: '/tools/ninja', c: '/tools/cc', cxx: '/tools/cxx', pkgConfig: '/tools/pkg-config' } };
	assert.throws(() => createMotionReferenceCompilePlan(input), /install|closure/u);
	assert.throws(() => createMotionReferenceCompileEnvironment({ PATH: '/tools' }, installRoots, 'linux-x64'), /install|closure/u);
});

test('reference compiler refuses foreign, reordered, duplicated and extra static install roots', () => {
	const installRoots = roots('/native');
	for (const changed of [installRoots.map(root => root.replace('svt-av1-install', 'foreign-install')),
		installRoots.map(root => root.endsWith('/svt-av1-install') ? '/other/svt-av1-install' : root),
		[...installRoots].reverse(), [...installRoots.slice(0, -1), installRoots[0]!], [...installRoots, '/native/foreign-install']]) {
		assert.throws(() => createMotionReferenceCompileEnvironment({ PATH: '/tools' }, changed, 'linux-x64'), /install|closure/u);
	}
});
