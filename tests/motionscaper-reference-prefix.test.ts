/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureMotionReferencePrefixClosure, motionReferenceInstallRoots, requireMotionReferencePrefixClosure } from '../scripts/lib/motionscaper-reference-prefix.ts';

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

test('reference authority retains the SVT-AV1 recipe prefix and rejects its body drift', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-reference-svt-prefix-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const names = ['ffmpeg', 'x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'];
	const expectedRoots = names.map(name => join(root, 'media-build', `${name}-install`));
	assert.deepEqual(motionReferenceInstallRoots(root), expectedRoots);
	for (const [index, directory] of expectedRoots.entries()) {
		await mkdir(join(directory, 'lib'), { recursive: true });
		await writeFile(join(directory, 'lib', index === 4 ? 'libSvtAv1Enc.a' : 'libcodec.a'), `owned ${names[index]} static library\n`);
	}
	const expected = await captureMotionReferencePrefixClosure(expectedRoots);
	assert.equal(expected.length, 7);
	assert.deepEqual(expected[4]?.files.map(file => file.path), ['lib/libSvtAv1Enc.a']);
	await writeFile(join(expectedRoots[4]!, 'lib', 'libSvtAv1Enc.a'), 'substituted SVT encoder library\n');
	const changed = await captureMotionReferencePrefixClosure(expectedRoots);
	assert.throws(() => { requireMotionReferencePrefixClosure(expected, changed); }, /closure/u);
	await assert.rejects(captureMotionReferencePrefixClosure([...expectedRoots, join(root, 'foreign-install')]), /closed/u);
});
