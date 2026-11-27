/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { provisionTracktionSources } from './lib/tracktion-sources.mjs';

const root = realpathSync(resolve(import.meta.dirname, '..'));
const buildOnly = process.argv[2] === '--build-peer';
if (process.argv.length > 3 || (process.argv.length === 3 && !buildOnly)) {
	throw new Error('Usage: test-tracktion-session.mjs [--build-peer]');
}
const buildDirectory = resolve(root, '.native-build/tracktion-session');
const isWindows = process.platform === 'win32';
const sources = await provisionTracktionSources();
const options = { cwd: root, stdio: 'inherit', env: { ...process.env, CMAKE_BUILD_PARALLEL_LEVEL: '2' } };
const windowsDefinitions = [];
if (isWindows) {
	const nativeSourceCache = resolve(root, '.native-build/tracktion-windows-sources');
	execFileSync(process.execPath, [
		'scripts/provision-milestone-5-native-sources.mjs', '--source', 'asio-sdk', '--root', nativeSourceCache,
	], options);
	windowsDefinitions.push(`-DSOUNDSCAPER_ASIO_ROOT=${resolve(nativeSourceCache, 'asio-sdk/source')}`);
	const generator = process.env.CMAKE_GENERATOR;
	if (!generator || generator.startsWith('Visual Studio ')) {
		windowsDefinitions.push('-A', process.arch === 'arm64' ? 'ARM64' : 'x64');
	}
}

execFileSync('cmake', [
	'-S', 'native/soundscaper-tracktion', '-B', buildDirectory, '-DCMAKE_BUILD_TYPE=Release',
	`-DSOUNDSCAPER_TRACKTION_SOURCE=${sources.tracktion}`, `-DSOUNDSCAPER_TRACKTION_JUCE_SOURCE=${sources.juce}`,
	...(isWindows ? windowsDefinitions : ['-DCMAKE_C_FLAGS_RELEASE=-O2 -DNDEBUG', '-DCMAKE_CXX_FLAGS_RELEASE=-O2 -DNDEBUG']),
], options);
execFileSync('cmake', ['--build', buildDirectory, '--config', 'Release', '--parallel', '2',
	...(buildOnly ? ['--target', 'soundscaper_tracktion_peer'] : [])], options);
if (!buildOnly) execFileSync('ctest', ['--test-dir', buildDirectory, '-C', 'Release', '--output-on-failure'], options);
