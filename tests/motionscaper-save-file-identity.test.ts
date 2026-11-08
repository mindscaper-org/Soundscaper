/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { type BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertMotionSaveDirectory, captureMotionSaveDirectory } from '../desktop/motion-save-publication-journal.ts';
import { motionSaveFingerprint, sameMotionSaveFile } from '../desktop/motion-save-file-identity.ts';

async function details(overrides: Partial<BigIntStats> = {}): Promise<BigIntStats> {
	return Object.assign(await lstat(import.meta.filename, { bigint: true }), {
		dev: 2731094893n, ino: 17169973583882990n, size: 3n,
		mtimeNs: 1700000000123456789n, ctimeNs: 1700000000987654321n,
		mtimeMs: 1700000000123n, ctimeMs: 1700000000987n,
	}, overrides);
}

test('selected Motion Save directories retain exact filesystem IDs and reject directory replacement', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-save-identity-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const directory = join(root, 'selected'); await mkdir(directory);
	const path = join(directory, 'saved.mscape'), stat = await lstat(directory, { bigint: true });
	const identity = await captureMotionSaveDirectory(path);
	assert.deepEqual(identity, { dev: BigInt.asUintN(64, stat.dev).toString(), ino: BigInt.asUintN(64, stat.ino).toString() });
	await assertMotionSaveDirectory(path, identity);
	await rename(directory, join(root, 'original')); await mkdir(directory);
	await assert.rejects(assertMotionSaveDirectory(path, identity), /selected Motion Save directory changed/u);
});

test('Motion file fingerprints distinguish NTFS IDs that collide as JavaScript numbers', async () => {
	const first = await details({ ino: 13510798887756415n }), second = await details({ ino: 13510798887756416n });
	assert.equal(Number(first.ino), Number(second.ino), 'The fixture must reproduce numeric identity precision loss.');
	const left = motionSaveFingerprint(first), right = motionSaveFingerprint(second);
	assert.equal(left.dev, '2731094893'); assert.equal(left.ino, '13510798887756415');
	assert.equal(right.ino, '13510798887756416'); assert.equal(left.size, 3);
	assert.equal(sameMotionSaveFile(left, right), false); assert.equal(sameMotionSaveFile(left, { ...left }), true);
});

test('one BigInt stat retains the existing fractional-millisecond timestamp precision', async () => {
	const identity = motionSaveFingerprint(await details());
	assert.equal(identity.mtimeMs, 1700000000123.4568);
	assert.equal(identity.ctimeMs, 1700000000987.6543);
});

test('negative epoch timestamps retain Node numeric Stats timespec rounding', async () => {
	for (const [nanoseconds, seconds, fraction] of [[-1n, -1, 999999999], [-1000000001n, -2, 999999999]] as const) {
		const identity = motionSaveFingerprint(await details({ mtimeNs: nanoseconds, ctimeNs: nanoseconds }));
		const numericStatsMilliseconds = seconds * 1000 + fraction / 1000000;
		assert.equal(identity.mtimeMs, numericStatsMilliseconds); assert.equal(identity.ctimeMs, numericStatsMilliseconds);
	}
});

test('Motion fingerprints keep safe numeric sizes without imposing the Save limit on delivery', async () => {
	assert.equal(motionSaveFingerprint(await details({ size: 0n })).size, 0);
	assert.equal(motionSaveFingerprint(await details({ size: 256n * 1024n ** 3n })).size, 256 * 1024 ** 3);
	for (const size of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
		const stat = await details({ size });
		assert.throws(() => motionSaveFingerprint(stat), /size/iu);
	}
});
