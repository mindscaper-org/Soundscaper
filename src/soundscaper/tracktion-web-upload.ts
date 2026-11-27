/* SPDX-License-Identifier: AGPL-3.0-only */

const uploadLimitMiB = { WAV: 16, ZIP: 65 } as const;

export function requireTracktionWebUpload(bytes: number, format: keyof typeof uploadLimitMiB): void {
	const limit = uploadLimitMiB[format];
	if (bytes === 0) throw new Error(`Choose a nonempty ${format} file for Tracktion`);
	if (bytes > limit * 1024 * 1024) throw new Error(`The browser Tracktion core accepts ${format} files up to ${limit} MiB`);
}
