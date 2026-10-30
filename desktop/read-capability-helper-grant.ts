/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import { exactOriginalFileIdentity } from './original-file-identity.ts';
import { safeReadFileSize } from './read-capability-admission.js';
import { assertReadCapabilityFileIdentity, requireReadCapabilityOwner } from './read-capability-support.js';

type FileIdentity = Readonly<Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'ctimeMs'>>;

interface Entry {
	readonly id: string;
	readonly path: string;
	readonly owner: object;
	readonly handle: Pick<FileHandle, 'stat'>;
	readonly fileIdentity: FileIdentity;
}

type ConfirmCurrent = (entry: Entry) => boolean;

/** Main-only grants retain the read owner; paths and identities never cross IPC. */
export async function resolveReadCapabilityHelperGrant(entry: Entry | null, owner: object | undefined,
	fullIdentity: boolean, confirmCurrent: ConfirmCurrent) {
	requireReadCapabilityOwner(owner);
	if (!entry || entry.owner !== owner) return null;
	const details = await entry.handle.stat();
	if (!confirmCurrent(entry)) return null;
	return Object.freeze({ path: entry.path, size: safeReadFileSize(details.size),
		identity: fullIdentity ? entry.fileIdentity : Object.freeze({ dev: details.dev, ino: details.ino }),
	});
}

/** Windows NTFS file IDs require bigint even for small writable media files. */
export async function resolveReadCapabilityOriginalFileGrant(entry: Entry | null, owner: object | undefined,
	confirmCurrent: ConfirmCurrent) {
	requireReadCapabilityOwner(owner);
	if (!entry || entry.owner !== owner) return null;
	const exact = await entry.handle.stat({ bigint: true });
	// Keep the original admission snapshot's change fence as well as the exact ID.
	assertReadCapabilityFileIdentity(await entry.handle.stat(), entry.fileIdentity);
	if (!confirmCurrent(entry)) return null;
	return Object.freeze({ path: entry.path, identity: exactOriginalFileIdentity(exact) });
}
