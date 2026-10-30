/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BigIntStats } from 'node:fs';

export type ExactOriginalFileIdentity = Readonly<Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'>>;

/** Retain every bit of Windows NTFS file IDs and nanosecond change fences. */
export function exactOriginalFileIdentity(details: BigIntStats): ExactOriginalFileIdentity {
	return Object.freeze({ dev: details.dev, ino: details.ino, size: details.size,
		mtimeNs: details.mtimeNs, ctimeNs: details.ctimeNs });
}
