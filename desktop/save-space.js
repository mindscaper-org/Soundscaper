/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, readlink } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

export const SPACE_EXHAUSTED_MESSAGE = 'The save destination ran out of space; the staged file was discarded';

/** Space exhaustion is terminal for a staged save; other write failures stay retryable. */
export function isSpaceExhaustedError(error) {
	const code = error?.code ?? error?.cause?.code;
	return code === 'ENOSPC' || code === 'EDQUOT';
}

export function commitFailureMessage(error) {
	if (error?.code === 'PROJECT_SAVE_DESTINATION_CHANGED') {
		return 'The selected project save destination changed. Choose it again before saving.';
	}
	return isSpaceExhaustedError(error)
		? 'Could not commit the saved file: the destination ran out of space'
		: 'Could not commit the saved file';
}

export function saveBinaryBuffer(value) {
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	throw new TypeError('Save chunks must be binary data');
}

export function isMissingSavePathError(error) {
	return error && typeof error === 'object' && error.code === 'ENOENT';
}

export function canTrackTemporarySaveFile(handle) {
	return process.platform === 'linux' && Number.isInteger(handle.fd) && handle.fd >= 0;
}

export async function assertTemporarySaveFileCurrent(path, identity) {
	if (!await sameSaveFile(path, identity)) throw new Error('The temporary save file changed before publication');
}

/** Resolve the owned stage while its descriptor still pins the inode. */
async function unlinkTrackedSaveFile(handle, originalPath, unlinkTemporary) {
	const identity = await handle.stat({ bigint: true });
	if (identity.nlink === 0n) return;
	let path = originalPath;
	try { path = await readlink(`/proc/self/fd/${handle.fd}`); }
	catch (error) {
		if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) throw error;
	}
	if (!isAbsolute(path) || basename(path) !== basename(originalPath) || !await sameSaveFile(path, identity)) {
		if ((await handle.stat({ bigint: true })).nlink === 0n) return;
		throw new Error('The owned temporary save pathname is no longer reachable');
	}
	try { await unlinkTemporary(path); }
	catch (error) {
		if (!isMissingSavePathError(error)) throw error;
		if ((await handle.stat({ bigint: true })).nlink !== 0n) {
			throw new Error('The owned temporary save pathname moved during cleanup', { cause: error });
		}
	}
}

async function sameSaveFile(path, identity) {
	try {
		const observed = await lstat(path, { bigint: true });
		return observed.isFile() && observed.dev === identity.dev && observed.ino === identity.ino;
	} catch (error) {
		if (isMissingSavePathError(error) || error?.code === 'ENOTDIR') return false;
		throw error;
	}
}

export async function cleanupTemporarySaveFile({ handle, temporaryPath }, unlinkTemporary, { closeHandle, removeTemporary }) {
	const errors = [];
	const tracked = closeHandle && canTrackTemporarySaveFile(handle);
	const remove = async () => {
		try {
			if (tracked) await unlinkTrackedSaveFile(handle, temporaryPath, unlinkTemporary);
			else await unlinkTemporary(temporaryPath);
		} catch (error) {
			if (tracked || !isMissingSavePathError(error)) errors.push(new Error('Could not remove the temporary save file', { cause: error }));
		}
	};
	if (removeTemporary && tracked) await remove();
	if (closeHandle) {
		try { await handle.close(); }
		catch (error) { errors.push(new Error('Could not close the temporary save file', { cause: error })); }
	}
	if (removeTemporary && !tracked) await remove();
	return errors;
}

export function requireSaveOwner(owner) {
	if ((typeof owner !== 'object' || owner === null) && typeof owner !== 'function') {
		throw new TypeError('A renderer save owner object reference is required');
	}
}

export function boundedSaveCapacity(value, maximum, label) {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new RangeError(`${label} must be a non-negative integer no greater than the hard limit of ${maximum}`);
	}
	return value;
}

export function availableSaveStorageBytes(details) {
	if (!details || typeof details !== 'object'
		|| typeof details.bavail !== 'bigint' || details.bavail < 0n
		|| typeof details.bsize !== 'bigint' || details.bsize <= 0n) {
		throw new TypeError('Expected non-negative bigint bavail and positive bigint bsize values');
	}
	return details.bavail * details.bsize;
}

export function createSaveDiskAdmission(stat, statfs) {
	const destinations = new Map();
	return {
		async check(directory, reservation) {
			const device = await saveDiskDevice(stat, directory);
			// Take the pending-byte snapshot before statfs samples the free blocks.
			let remainingBytes = reservation.admittedSize;
			for (const [previous, previousDevice] of destinations) {
				if (device === null || previousDevice === null || previousDevice === device) {
					remainingBytes += previous.admittedSize - previous.written;
				}
			}
			destinations.set(reservation, device);
			let details;
			try {
				details = await statfs(directory, { bigint: true });
			} catch (error) {
				throw new Error('Could not inspect filesystem capacity for the save', { cause: error });
			}
			let availableBytes;
			try {
				availableBytes = availableSaveStorageBytes(details);
			} catch (error) {
				throw new Error('Filesystem capacity information is invalid', { cause: error });
			}
			if (availableBytes < BigInt(remainingBytes)) {
				throw new RangeError('Available disk space is below the aggregate admitted save capacity');
			}
		},
		release(reservation) { destinations.delete(reservation); },
	};
}

async function saveDiskDevice(stat, path) {
	try {
		const { dev } = await stat(path, { bigint: true });
		if (typeof dev === 'bigint' && dev > 0n) return dev;
	} catch { /* Unidentified destinations still use conservative aggregate accounting and must pass statfs. */ }
	return null;
}
