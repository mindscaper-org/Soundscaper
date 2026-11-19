/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { link, lstat, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const PROBE = '.probe';
const PROBE_LINK = '.probe-link';
const STAGE_FILE = /^[a-f0-9]{64}$/u;

/** One caller-owned directory on the destination volume holds copy and publication receipts. */
export class DesktopStorageCopyStage {
	#directory: Promise<BigIntStats> | undefined;
	#capability: Promise<boolean> | undefined;
	#path: string | undefined;

	constructor(path: string | undefined, private readonly create: (() => Promise<string>) | undefined,
		private readonly linkFile: typeof link) { this.#path = path; }

	async #ready(): Promise<{ path: string; metadata: BigIntStats }> {
		this.#path ??= await this.create?.();
		const path = this.#path;
		if (path === undefined) throw new Error('The migration copy stage has no directory.');
		this.#directory ??= lstat(path, { bigint: true }).then((entry) => {
			if (!entry.isDirectory()) throw new Error('The migration copy stage is no longer a directory.');
			return entry;
		});
		return { path, metadata: await this.#directory };
	}

	#filePath(path: string, destination: string): string {
		return join(path, createHash('sha256').update(destination).digest('hex'));
	}

	async prepareFile(destination: string): Promise<string | null> {
		const { path, metadata: stage } = await this.#ready();
		const parent = await lstat(dirname(destination), { bigint: true });
		if (stage.dev !== parent.dev) return null;
		this.#capability ??= this.#probe(path);
		if (!await this.#capability) return null;
		const file = this.#filePath(path, destination);
		// The final name is still vacant. Restart any interrupted private copy.
		await this.removeFile(destination);
		return file;
	}

	async publish(stage: string, destination: string): Promise<boolean> {
		try { await this.linkFile(stage, destination); }
		catch (error) {
			if (unsupportedLink(error)) return false;
			if (errorCode(error) === 'EEXIST') throw receiptConflict(destination);
			throw error;
		}
		return true;
	}

	async verifyReceipt(destination: string, verified?: BigIntStats): Promise<void> {
		if (this.#path === undefined) return;
		const { path } = await this.#ready();
		const stage = await optionalFile(this.#filePath(path, destination));
		if (stage === null) {
			if (verified !== undefined) throw receiptConflict(destination);
			return;
		}
		const final = await lstat(destination, { bigint: true });
		if (!final.isFile() || stage.nlink < 2n || !sameFile(stage, final)) {
			throw receiptConflict(destination);
		}
		if (verified !== undefined && (!sameFile(verified, final) || verified.mode !== final.mode
			|| verified.size !== final.size || verified.mtimeNs !== final.mtimeNs)) {
			throw new Error(`The staged file changed during migration publication: "${destination}".`);
		}
	}

	async removeFile(destination: string): Promise<void> {
		if (this.#path !== undefined) await removeStageFile(this.#filePath(this.#path, destination));
	}

	async #probe(path: string): Promise<boolean> {
		const from = join(path, PROBE);
		const to = join(path, PROBE_LINK);
		await removeStageFile(from);
		await removeStageFile(to);
		try {
			await writeFile(from, '', { flag: 'wx', mode: 0o600 });
			await this.linkFile(from, to);
			const [original, linked] = await Promise.all([lstat(from, { bigint: true }), lstat(to, { bigint: true })]);
			return original.nlink === 2n && sameFile(original, linked);
		} catch (error) {
			if (unsupportedLink(error)) return false;
			throw error;
		} finally {
			await removeStageFile(to);
			await removeStageFile(from);
		}
	}
}

/** Source retirement can finish before its last receipt is cleaned up. */
export async function clearDesktopStorageCopyStage(path: string): Promise<void> {
	try {
		if (!(await lstat(path)).isDirectory()) throw new Error('The migration copy stage is no longer a directory.');
		for (const name of await readdir(path)) {
			if (STAGE_FILE.test(name) || name === PROBE || name === PROBE_LINK) await removeStageFile(join(path, name));
		}
		await rmdir(path);
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') throw error;
	}
}

async function optionalFile(path: string): Promise<BigIntStats | null> {
	let entry: BigIntStats;
	try { entry = await lstat(path, { bigint: true }); }
	catch (error) {
		if (errorCode(error) === 'ENOENT') return null;
		throw error;
	}
	if (!entry.isFile()) throw new Error(`Unexpected entry in the migration copy stage: "${path}".`);
	return entry;
}

async function removeStageFile(path: string): Promise<void> {
	if (await optionalFile(path) !== null) await unlink(path);
}

function receiptConflict(destination: string): Error {
	return new Error(`Verification conflict at "${destination}": the destination was created independently of the staged copy.`);
}

function sameFile(first: BigIntStats, second: BigIntStats): boolean {
	return first.ino > 0n && first.dev === second.dev && first.ino === second.ino;
}

function unsupportedLink(error: unknown): boolean {
	return ['EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM', 'EMLINK'].includes(errorCode(error));
}

function errorCode(error: unknown): string {
	return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}
