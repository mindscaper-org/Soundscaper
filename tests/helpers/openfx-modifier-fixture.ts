/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';

import type { OfxInteractEventV1 } from '../../src/common/editor/native-ofx-host-contract.ts';
import { buildOpenFxNativeContractFixture } from './openfx-native-scanner-fixture.js';
import { runNativeExecutable } from './openfx-native-runtime-process.js';

interface ModifierFixture {
	readonly directory: string;
	readonly plugin: string;
	readonly sha256: string;
	readonly runtime: string;
}

let retained: ModifierFixture | undefined;

export function buildOpenFxModifierFixture(context: Pick<TestContext, 'skip'>) {
	if (retained) return retained;
	const build = buildOpenFxNativeContractFixture(context);
	if (!build) return null;
	const extension = process.platform === 'darwin' ? '.dylib' : process.platform === 'win32' ? '.dll' : '.so';
	const plugin = join(build.directory, `modifier${extension}`);
	const compile = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		'-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1', '-DFRAMESCAPER_OPENFX_CONFORMANCE_FIXTURE=1',
		'-I', resolve('native/framescaper-openfx-host/src'),
		...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']),
		resolve('tests/fixtures/openfx-modifier-plugin.cpp'), '-o', plugin,
	], { encoding: 'utf8' });
	assert.equal(compile.status, 0, compile.stderr);
	retained = { directory: build.directory, plugin, sha256: sha256(readFileSync(plugin)),
		get runtime() { return build.runtime; } };
	return retained;
}

export function runOpenFxModifierFixture(
	build: NonNullable<ReturnType<typeof buildOpenFxModifierFixture>>,
	events: readonly OfxInteractEventV1[],
) {
	// Main serializes this closed grant in canonical member order.
	const canonicalEvents = events.map(event => event.kind === 'pointer'
		? { kind: event.kind, phase: event.phase, sequence: event.sequence, x: event.x, y: event.y,
			button: event.button, modifiers: event.modifiers }
		: event.kind === 'keyboard' ? { kind: event.kind, phase: event.phase, sequence: event.sequence,
			key: event.key, code: event.code, modifiers: event.modifiers }
			: { kind: event.kind, sequence: event.sequence, focused: event.focused });
	const grant = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		pluginBinary: { path: build.plugin, sha256: build.sha256, pluginIndex: 0,
			pluginId: 'org.framescaper.conformance' },
		project: { id: 'modifier-project', revision: 7 }, instanceId: 'controls',
		effectStateSha256: '44'.repeat(32), context: 'filter', target: 'overlay', parameterName: null,
		parameters: [{ name: 'parameter0', type: 'integer', value: 3, keyframes: [{ frame: 12, value: 9 }] }],
		events: canonicalEvents,
	}));
	const path = join(build.directory, 'modifier-grant.json');
	writeFileSync(path, grant);
	return runNativeExecutable(build.runtime, ['--interact-v1-grant', path, '--grant-sha256', sha256(grant)]);
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
