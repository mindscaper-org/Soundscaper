/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { motionAuthoredBundleIdentity } from '../desktop/motionscaper-authored-bundle-identity.ts';

test('Mac bundle custody retains internal framework symlinks and their destination bytes', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'motion-bundle-')));
	try {
		await mkdir(join(directory, 'Framework.framework', 'Versions', 'A'), { recursive: true });
		await writeFile(join(directory, 'Framework.framework', 'Versions', 'A', 'Framework'), 'framework bytes');
		await symlink('A', join(directory, 'Framework.framework', 'Versions', 'Current'));
		await symlink('Versions/Current/Framework', join(directory, 'Framework.framework', 'Framework'));
		const before = await motionAuthoredBundleIdentity(directory);
		assert.equal(before.filter(value => 'link' in value).length, 2);
		assert.ok(before.some(value => value.path === 'Framework.framework/Versions/A/Framework' && 'sha256' in value));
		await writeFile(join(directory, 'Framework.framework', 'Versions', 'A', 'Framework'), 'changed framework');
		assert.notDeepEqual(await motionAuthoredBundleIdentity(directory), before);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('Mac bundle custody rejects a symlink escaping the authenticated package container', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'motion-bundle-escape-')));
	try {
		await mkdir(join(directory, 'package')); await writeFile(join(directory, 'outside'), 'foreign bytes');
		await symlink('../outside', join(directory, 'package', 'Framework'));
		await assert.rejects(motionAuthoredBundleIdentity(join(directory, 'package')), /escape/u);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
