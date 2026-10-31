/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureMotionReferencePrefixClosure, requireMotionReferencePrefixClosure } from '../scripts/lib/motionscaper-reference-prefix.ts';

test('independent codec authority captures the complete include/lib membership and rejects body drift', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-reference-prefix-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'include')); await mkdir(join(root, 'lib'));
	await writeFile(join(root, 'include', 'codec.h'), 'owned header\n');
	await writeFile(join(root, 'include', 'empty-config.h'), '');
	await writeFile(join(root, 'lib', 'codec.a'), 'owned static codec\n');
	const expected = await captureMotionReferencePrefixClosure([root]);
	assert.deepEqual(expected[0]?.files.map(file => file.path), ['include/codec.h', 'include/empty-config.h', 'lib/codec.a']);
	assert.equal(expected[0]?.files.find(file => file.path.endsWith('empty-config.h'))?.byteLength, 0);
	assert.doesNotThrow(() => { requireMotionReferencePrefixClosure(expected, expected); });
	await writeFile(join(root, 'lib', 'codec.a'), 'substituted static codec\n');
	const changed = await captureMotionReferencePrefixClosure([root]);
	assert.throws(() => { requireMotionReferencePrefixClosure(expected, changed); }, /closure/u);
	await writeFile(join(root, 'lib', 'extra.a'), 'unadmitted library\n');
	const extra = await captureMotionReferencePrefixClosure([root]);
	assert.throws(() => { requireMotionReferencePrefixClosure(expected, extra); }, /closure/u);
});

test('independent codec authority refuses symbolic links instead of excluding them', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-reference-prefix-link-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'include')); await writeFile(join(root, 'include', 'library.h'), 'owned header\n');
	await symlink(join(root, 'include'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
	await assert.rejects(captureMotionReferencePrefixClosure([root]), /symlink|regular/u);
});
