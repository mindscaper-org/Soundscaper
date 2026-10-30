/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ScapeArchiveLimits {
	maximumEntryCount: number;
	maximumManifestBytes: number;
	maximumProjectBytes: number;
	maximumExpandedBytes: number;
}

export const SCAPE_ARCHIVE_LIMITS: Readonly<ScapeArchiveLimits> = Object.freeze({
	maximumEntryCount: 4_096,
	maximumManifestBytes: 32 * 1024 * 1024,
	maximumProjectBytes: 256 * 1024 * 1024,
	maximumExpandedBytes: 64 * 1024 * 1024 * 1024,
});
