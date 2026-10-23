/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { buildOpenFxNativeContractFixture } from './openfx-native-scanner-fixture.js';

let retained: Readonly<{ directory: string; plugin: string; sha256: string; runtime: string }> | undefined;
export function buildOpenFxRepeatFixture(context: Pick<TestContext, 'skip'>) {
	if (retained) return retained;
	const build = buildOpenFxNativeContractFixture(context);
	if (!build) return null;
	const plugin = join(build.directory, `repeat${process.platform === 'darwin' ? '.dylib' : process.platform === 'win32' ? '.dll' : '.so'}`);
	const result = spawnSync('c++', ['-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		'-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1', '-DFRAMESCAPER_OPENFX_CONFORMANCE_FIXTURE=1',
		'-I', resolve('native/framescaper-openfx-host/src'), ...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']),
		resolve('tests/fixtures/openfx-repeat-plugin.cpp'), '-o', plugin], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	retained = { directory: build.directory, plugin, sha256: createHash('sha256').update(readFileSync(plugin)).digest('hex'), get runtime() { return build.runtime; } };
	return retained;
}
