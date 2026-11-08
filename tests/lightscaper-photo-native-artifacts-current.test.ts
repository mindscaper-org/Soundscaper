/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { chmod, mkdir, open, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readLightscaperPhotoNativeBuildResultCurrentV1 as readResult } from '../scripts/lib/lightscaper-photo-native-artifacts-current-v1.ts';
import { photoNativeDeploymentFixtureCurrentV1 as fixture, PHOTO_NATIVE_TEST_CURRENT_V1 as options,
	PHOTO_NATIVE_BUILD_RESULT_CURRENT_V1 as resultFile, verify, photoNativeTargetCurrentV1 as target } from './helpers/lightscaper-photo-native-deployment-fixture-current.ts';

void test('actual prepared Photo result authenticates both fixed roles and exact target/source inventory', options, async context => fixture(context, async f => {
	assert.equal(f.result.schemaVersion, 1); assert.equal(f.result.kind, 'lightscaper-photo-native-build-result-current-v1'); assert.equal(f.result.target, target());
	assert.match(f.result.sourceInventorySha256, /^[a-f0-9]{64}$/u); assert.ok(f.result.sourceRevision === null || /^[a-f0-9]{40}$/u.test(f.result.sourceRevision));
	assert.equal(Object.keys(f.result.roles).sort().join(','), 'granted-filesystem,raw-engine');
	assert.equal(f.result.roles['granted-filesystem'].protocol, 'SGR1'); assert.equal(f.result.roles['granted-filesystem'].trust, 'trusted-readonly-broker');
	assert.equal(f.result.roles['raw-engine'].protocol, 'SRR1'); assert.equal(f.result.roles['raw-engine'].trust, 'isolated-zero-path');
	for (const role of Object.values(f.result.roles)) assert.ok(f.result.files.some(file => file.path === role.payloadPath));
	assert.ok(f.result.files.some(file => file.path === f.result.isolation.launcherPath));
	assert.ok(f.result.selfTests.length > 0 && f.result.selfTests.every(result => result.status === 'passed'));
	assert.equal(readResult(f.result).sourceInventorySha256, f.result.sourceInventorySha256);
	assert.equal((await verify({ repositoryRoot: f.repositoryRoot, buildResultRoot: f.buildResultRoot, target: target() })).target, target());
}));

void test('Photo artifact profile refuses false role trust/protocol and duplicate/traversing inventory', options, async context => fixture(context, async f => {
	const fs = f.result.roles['granted-filesystem'], raw = f.result.roles['raw-engine'];
	for (const value of [
		{ ...f.result, roles: { ...f.result.roles, 'granted-filesystem': { ...fs, trust: 'isolated-zero-path' } } },
		{ ...f.result, roles: { ...f.result.roles, 'raw-engine': { ...raw, protocol: 'SGR1' } } },
		{ ...f.result, files: [...f.result.files, f.result.files[0]] },
		{ ...f.result, roles: { ...f.result.roles, 'raw-engine': { ...raw, payloadPath: '../outside' } } },
		{ ...f.result, target: 'darwin-x64' }, { ...f.result, additional: true },
		{ ...f.result, selfTests: [] }, { ...f.result, sourceInventorySha256: 'unbound' },
		{ ...f.result, roles: { 'granted-filesystem': fs } },
	]) assert.throws(() => readResult(value));
}));

void test('actual native payload byte mutation refuses authenticated build-result verification', options, async context => fixture(context, async f => {
	const path = join(f.buildResultRoot, f.result.roles['granted-filesystem'].payloadPath); await chmod(path, 0o700);
	const file = await open(path, 'r+'); try { const byte = new Uint8Array(1); assert.equal((await file.read(byte, 0, 1, 0)).bytesRead, 1); byte[0] = byte[0]! ^ 1; await file.write(byte, 0, 1, 0); await file.sync(); } finally { await file.close(); }
	await assert.rejects(verify({ repositoryRoot: f.repositoryRoot, buildResultRoot: f.buildResultRoot, target: target() }));
}));

void test('actual build-result inventory rejects extra files and source inventory replacement', options, async context => fixture(context, async f => {
	const path = join(f.buildResultRoot, resultFile), bytes = await readFile(path);
	await writeFile(path, `${JSON.stringify({ ...f.result, sourceInventorySha256: '0'.repeat(64) })}\n`);
	await assert.rejects(verify({ repositoryRoot: f.repositoryRoot, buildResultRoot: f.buildResultRoot, target: target() }));
	await writeFile(path, bytes); await writeFile(join(f.buildResultRoot, 'unowned-extra'), 'foreign');
	await assert.rejects(verify({ repositoryRoot: f.repositoryRoot, buildResultRoot: f.buildResultRoot, target: target() }));
}));

void test('actual symlinked native member and another target result refuse before runtime staging', options, async context => fixture(context, async f => {
	const foreign = join(f.directory, 'foreign'); await mkdir(foreign);
	await symlink(foreign, join(f.buildResultRoot, 'foreign-link'), process.platform === 'win32' ? 'junction' : 'dir');
	await assert.rejects(verify({ repositoryRoot: f.repositoryRoot, buildResultRoot: f.buildResultRoot, target: target() }));
	const other = target() === 'linux-x64' ? 'linux-arm64' : 'linux-x64';
	await assert.rejects(verify({ repositoryRoot: f.repositoryRoot, buildResultRoot: f.buildResultRoot, target: other }));
}));
