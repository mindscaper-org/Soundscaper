/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

interface DirectorySyncHandle {
	stat(): Promise<Readonly<{ isDirectory(): boolean }>>;
	sync(): Promise<void>;
	close(): Promise<void>;
}

type OpenDirectoryForSync = (directory: string) => PromiseLike<DirectorySyncHandle>;

const UNSUPPORTED_DIRECTORY_SYNC_CODES = Object.freeze([
	'EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EPERM',
]);

export function isDirectorySyncUnsupported(error: unknown): boolean {
	const code = error && typeof error === 'object' && 'code' in error
		? String((error as Readonly<{ code?: unknown }>).code ?? '')
		: '';
	return UNSUPPORTED_DIRECTORY_SYNC_CODES.includes(code);
}

/** Durably publish a preceding rename where the host filesystem supports directory fsync. */
export async function syncDirectory(
	directory: string,
	openDirectory: OpenDirectoryForSync = openDirectoryForSync,
): Promise<void> {
	let handle: DirectorySyncHandle | null = null;
	try {
		handle = await openDirectory(directory);
		const details = await handle.stat();
		if (!details.isDirectory()) throw new Error('The checkpoint durability scope is not a directory.');
		await handle.sync();
	} catch (error) {
		if (!isDirectorySyncUnsupported(error)) throw error;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function openDirectoryForSync(directory: string): Promise<DirectorySyncHandle> {
	return open(
		directory,
		constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
	);
}
