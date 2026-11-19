/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdtemp, open, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { validateAudacityWal } from './audacity-wal-validation.ts';

interface Snapshot { readonly path: string; dispose(): Promise<void> }

/** Only main knows the selected path. SHM is checked but rebuilt exclusively in private scratch. */
export async function prepareAudacityWalSnapshot(original: string): Promise<Snapshot | null> {
	const paths = ['', '-wal', '-shm'].map(suffix => original + suffix);
	const companions = await Promise.all(paths.slice(1).map(stamp));
	if (!companions[0]?.size) return null;
	const stamps = [await stamp(original), ...companions];
	if (!stamps[0]) throw new Error('The Audacity project file is missing.');
	const folder = await mkdtemp(join(tmpdir(), 'soundscaper-audacity-recovery-'));
	const path = join(folder, basename(original));
	const dispose = async (): Promise<void> => { await rm(folder, { recursive: true, force: true }); };
	try {
		await copy(paths[0]!, path, stamps[0]);
		await copy(paths[1]!, path + '-wal', stamps[1]!);
		const wal = await validateAudacityWal(path + '-wal');
		const main = await open(path, 'r');
		try {
			const header = Buffer.alloc(100);
			if ((await main.read(header, 0, 100, 0)).bytesRead !== 100
				|| (header.readUInt16BE(16) === 1 ? 65536 : header.readUInt16BE(16)) !== wal.pageSize) throw new Error('The Audacity project and WAL page sizes do not match.');
		} finally { await main.close(); }
		const database = new DatabaseSync(path, { allowExtension: false, enableDoubleQuotedStringLiterals: false });
		try {
			database.exec('PRAGMA trusted_schema=OFF; PRAGMA cache_size=-8192; PRAGMA mmap_size=0;');
			const checkpoint = database.prepare('PRAGMA wal_checkpoint(FULL)').get();
			if (!checkpoint || Number(checkpoint.busy) !== 0 || Number(checkpoint.log) !== wal.committedFrames
				|| Number(checkpoint.checkpointed) !== wal.committedFrames) throw new Error('The Audacity WAL could not be fully checkpointed in the recovery copy.');
			if (Number(database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy) !== 0) throw new Error('The Audacity WAL copy could not be finalized.');
		} finally { database.close(); }
		for (const [index, source] of paths.entries()) {
			if (!same(stamps[index] ?? null, await stamp(source))) throw new Error('The Audacity project or its companions changed during recovery. Close Audacity and try again.');
		}
		return { path, dispose };
	} catch (error) { await dispose(); throw error; }
}

async function stamp(path: string): Promise<BigIntStats | null> {
	try {
		const value = await lstat(path, { bigint: true });
		if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || value.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Audacity recovery requires each companion to be a regular file with one filesystem name.');
		return value;
	} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function same(first: BigIntStats | null, second: BigIntStats | null): boolean {
	return first === null || second === null ? first === second
		: ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => first[key as keyof BigIntStats] === second[key as keyof BigIntStats]);
}
async function copy(source: string, destination: string, expected: BigIntStats): Promise<void> {
	const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		if (!same(expected, await input.stat({ bigint: true }))) throw new Error('The Audacity companion changed before copying.');
		const output = await open(destination, 'wx', 0o600);
		try {
			const bytes = Buffer.alloc(1024 * 1024);
			for (let offset = 0; offset < Number(expected.size);) {
				const length = Math.min(bytes.length, Number(expected.size) - offset);
				if ((await input.read(bytes, 0, length, offset)).bytesRead !== length) throw new Error('The Audacity companion changed during copying.');
				for (let written = 0; written < length;) {
					const count = (await output.write(bytes, written, length - written, offset + written)).bytesWritten;
					if (!count) throw new Error('The Audacity recovery copy could not be written.');
					written += count;
				}
				offset += length;
			}
		} finally { await output.close(); }
		if (!same(expected, await input.stat({ bigint: true }))) throw new Error('The Audacity companion changed during copying.');
	} finally { await input.close(); }
}
