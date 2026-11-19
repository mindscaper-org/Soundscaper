/* SPDX-License-Identifier: AGPL-3.0-only */

import { retryDesktopDatabaseContention } from './desktop-database-contention.ts'

const CONTENDED_LEASE_MESSAGE = /^Soundscaper desktop baseline writer lease is busy$/u

export interface SoundscaperDesktopProjectLibraryLeaseWaitOptions {
	readonly waitMs: number
	readonly pollIntervalMs?: number
}

/** Wait for an expired or released writer fence without masking non-contention failures. */
export function acquireSoundscaperDesktopProjectLibraryLeaseWithWait<Lease>(
	acquire: () => Lease,
	options: SoundscaperDesktopProjectLibraryLeaseWaitOptions,
): Promise<Lease> {
	return retryDesktopDatabaseContention(acquire, { ...options, isWriterLeaseBusy })
}

function isWriterLeaseBusy(error: unknown): error is Error {
	return error instanceof Error && CONTENDED_LEASE_MESSAGE.test(error.message)
}
