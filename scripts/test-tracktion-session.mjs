/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { provisionTracktionSources } from './lib/tracktion-sources.mjs';

const root = realpathSync(resolve(import.meta.dirname, '..'));
const buildDirectory = resolve(root, '.native-build/tracktion-session');
const sources = await provisionTracktionSources();
const options = { cwd: root, stdio: 'inherit', env: { ...process.env, CMAKE_BUILD_PARALLEL_LEVEL: '2' } };

execFileSync('cmake', [
	'-S', 'native/soundscaper-tracktion', '-B', buildDirectory, '-DCMAKE_BUILD_TYPE=Release',
	`-DSOUNDSCAPER_TRACKTION_SOURCE=${sources.tracktion}`, `-DSOUNDSCAPER_TRACKTION_JUCE_SOURCE=${sources.juce}`,
	...(process.platform === 'win32' ? [] : ['-DCMAKE_C_FLAGS_RELEASE=-O0 -DNDEBUG', '-DCMAKE_CXX_FLAGS_RELEASE=-O0 -DNDEBUG']),
], options);
execFileSync('cmake', ['--build', buildDirectory, '--config', 'Release', '--parallel', '2'], options);
execFileSync('ctest', ['--test-dir', buildDirectory, '-C', 'Release', '--output-on-failure'], options);
