/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { normalizeOpenFxPointer } from '../src/common/editor/ui/dialogs/FramescaperOpenFxInteractPanel.tsx';
import type { OfxInteractEventV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import {
	buildOpenFxNativeContractFixture,
	cleanupOpenFxNativeContractFixture,
} from './helpers/openfx-native-scanner-fixture.js';
import { runNativeExecutable } from './helpers/openfx-native-runtime-process.js';

test.after(cleanupOpenFxNativeContractFixture);

const geometry = { left: 0, top: 0, width: 256, height: 256 };

for (const [name, button, buttons] of [['left mouse and pen contact', 0, 1], ['middle mouse', 1, 4]] as const) {
	test(`the OpenFX menu's ${name} drag reaches a pressure-sensitive native interact`, context => {
		const build = buildOpenFxNativeContractFixture(context);
		if (!build) return;
		const extension = process.platform === 'darwin' ? '.dylib' : process.platform === 'win32' ? '.dll' : '.so';
		const pluginPath = join(build.directory, `pressure-${button}${extension}`);
		const compile = spawnSync('c++', [
			'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			'-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1', '-DFRAMESCAPER_OPENFX_CONFORMANCE_FIXTURE=1',
			'-I', resolve('native/framescaper-openfx-host/src'),
			...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']),
			resolve('tests/fixtures/openfx-pointer-pressure-plugin.cpp'), '-o', pluginPath,
		], { encoding: 'utf8' });
		assert.equal(compile.status, 0, compile.stderr);
		const pointer = (phase: 'down' | 'motion' | 'up', sequence: number): OfxInteractEventV1 => ({
			kind: 'pointer', phase, sequence,
			...normalizeOpenFxPointer(geometry, { clientX: 64, clientY: 128,
				button: phase === 'motion' ? -1 : button, buttons: phase === 'up' ? 0 : buttons }, phase),
			modifiers: [],
		});
		const events: readonly OfxInteractEventV1[] = [
			{ kind: 'focus', sequence: 0, focused: true },
			pointer('down', 1), pointer('motion', 2), pointer('up', 3),
			{ kind: 'keyboard', phase: 'down', sequence: 4, key: 'Enter', code: 'Enter', modifiers: [] },
			{ kind: 'keyboard', phase: 'up', sequence: 5, key: 'Enter', code: 'Enter', modifiers: [] },
			{ kind: 'focus', sequence: 6, focused: false },
		];
		const grant = Buffer.from(JSON.stringify({
			schemaVersion: 1,
			pluginBinary: { path: pluginPath, sha256: sha256(readFileSync(pluginPath)), pluginIndex: 0,
				pluginId: 'org.framescaper.conformance' },
			project: { id: 'pressure-project', revision: 7 }, instanceId: 'paint-controls',
			effectStateSha256: '44'.repeat(32), context: 'filter', target: 'overlay', parameterName: null,
			parameters: [{ name: 'parameter0', type: 'integer', value: 3, keyframes: [{ frame: 12, value: 9 }] }], events,
		}));
		const grantPath = join(build.directory, `pressure-${button}.json`);
		writeFileSync(grantPath, grant);
		const result = runNativeExecutable(build.runtime, ['--interact-v1-grant', grantPath, '--grant-sha256', sha256(grant)]);
		assert.equal(result.status, 0, result.stderr);
		const response = JSON.parse(String(result.stdout)) as { acceptedSequences: number[]; parameterMutations: unknown[] };
		assert.deepEqual(response.acceptedSequences, [0, 1, 2, 3, 4, 5, 6]);
		assert.deepEqual(response.parameterMutations, [{ parameter: {
			name: 'parameter0', type: 'integer', value: 42, keyframes: [{ frame: 12, value: 9 }],
		} }], 'the complete drag can publish the plug-in change');
	});
}

test('hover motion retains zero native pressure', () => {
	for (const button of [-1, 0, 1, 2]) assert.equal(normalizeOpenFxPointer(geometry,
		{ clientX: 64, clientY: 128, button, buttons: 0 }).button, 0);
});

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
