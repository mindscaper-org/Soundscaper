/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

test('the Apple Silicon libvpx closure selects macOS rather than the upstream iPhoneOS target', () => {
	const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell']
		.map(role => [role, { path: `/tools/${role}` }]));
	const commands = createFramescaperMediaHostBuildCommands({
		target: { id: 'mac-arm64', cmakePreset: 'mac-arm64' }, hostRoot: '/host',
		ffmpegSourceRoot: '/ffmpeg', boostSourceRoot: '/boost', paths: framescaperMediaHostBuildPaths('/work'),
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib']
			.map(role => [role, `/sources/${role}`])),
		tools: { executables }, environment: { PATH: '/tools' }, configureFlags: [],
	}) as readonly { phase: string; args: readonly string[]; environment: Readonly<Record<string, string>> }[];
	const configure = commands.find(command => command.phase === 'libvpx-configure')!;
	// Pinned libvpx 1.16.0 reserves arm64-darwin-gcc for iOS. Its numbered
	// Darwin 20–25 targets select the macOS SDK and retain ARM SIMD dispatch.
	assert.match(configure.args.find(value => value.startsWith('--target='))!, /^--target=arm64-darwin2[0-5]-gcc$/u);
	assert.equal(configure.environment.MACOSX_DEPLOYMENT_TARGET, '13.0');
	assert.ok(configure.args.includes('--enable-runtime-cpu-detect'));
	assert.ok(!configure.args.includes('--disable-neon'));
	for (const command of commands.filter(command => command.phase.startsWith('libvpx-'))) {
		assert.equal(command.environment.MACOSX_DEPLOYMENT_TARGET, '13.0');
		assert.ok(!command.args.some(value => /iphone|ios-version/iu.test(value)));
	}
});
