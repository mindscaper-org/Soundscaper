/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { LIGHTSCAPER_DESKTOP_NATIVE_CI_TARGETS_CURRENT_V1 as targets,
	createLightscaperDesktopNativeCiPlanCurrentV1 as plan,
	readLightscaperDesktopNativeCiTargetCurrentV1 as target } from '../scripts/lib/lightscaper-desktop-native-ci-plan-current-v1.ts';

const revision = 'a'.repeat(40), workRoot = resolve('owned-native-ci-work'), nativeBuildResultRoot = resolve('authenticated-photo-result');
const expected = [
	['linux-x64', 'linux', 'x64', 'ubuntu-24.04'],
	['linux-arm64', 'linux', 'arm64', 'ubuntu-24.04-arm'],
	['mac-arm64', 'mac', 'arm64', 'macos-15'],
	['win-x64', 'win', 'x64', 'windows-2025'],
	['win-arm64', 'win', 'arm64', 'windows-11-arm'],
];

void test('internal native desktop qualification retains exactly the maintained native target set', () => {
	assert.deepEqual(targets.map(row => [row.target, row.platform, row.arch, row.runner]), expected);
	assert.ok(Object.isFrozen(targets));
	for (const row of targets) {
		assert.equal(target(row.target), row);
		assert.equal(row.node_arch, row.arch);
		assert.ok(Object.isFrozen(row));
	}
	for (const value of ['mac-x64', 'linux', 'win-arm64 ', '', undefined, {}]) assert.throws(() => target(value));
});

for (const row of expected) void test(`${row[0]} books separate native-linked and native-absent Web packages at one exact revision`, () => {
	const value = plan({ target: row[0]!, sourceRevision: revision, workRoot, nativeBuildResultRoot });
	assert.equal(value.target.target, row[0]); assert.equal(value.sourceRevision, revision);
	assert.deepEqual(value.phases.map(phase => [phase.name, phase.backend, phase.scenario, phase.nativeBuildResultRoot]),
		[['native', 'native', 'linked', nativeBuildResultRoot], ['web', 'web', 'managed', null]]);
	const paths = value.phases.flatMap(phase => [phase.buildRoot, phase.packageRoot, phase.smokeRoot]);
	assert.equal(new Set(paths).size, 6, 'fallback must be a fresh package, never a runtime flag on the native package');
	for (const phase of value.phases) {
		assert.equal(phase.buildRoot, resolve(workRoot, phase.name, 'stage'));
		assert.equal(phase.packageRoot, resolve(workRoot, phase.name, 'package'));
		assert.equal(phase.smokeRoot, resolve(workRoot, phase.name, 'smoke'));
		assert.ok(Object.isFrozen(phase));
	}
	assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.phases));
});

void test('the internal package plan rejects ambiguous revisions, unsupported hosts and overlapping source/output scopes', () => {
	for (const sourceRevision of ['', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(40) + '\n']) {
		assert.throws(() => plan({ target: 'linux-x64', sourceRevision, workRoot, nativeBuildResultRoot }));
	}
	assert.throws(() => plan({ target: 'mac-x64', sourceRevision: revision, workRoot, nativeBuildResultRoot }));
	for (const root of ['', 'relative', workRoot + '/..', workRoot + '\0']) {
		assert.throws(() => plan({ target: 'linux-x64', sourceRevision: revision, workRoot: root, nativeBuildResultRoot }));
	}
	for (const root of [workRoot, resolve(workRoot, 'native-result'), resolve(workRoot, '..')]) {
		assert.throws(() => plan({ target: 'linux-x64', sourceRevision: revision, workRoot, nativeBuildResultRoot: root }));
	}
});
