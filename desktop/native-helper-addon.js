/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reads, digest-checks and loads the addon; a mismatch never reaches dlopen. */
export async function loadVerifiedNativeAddon({ addonPath, addonSha256 }) {
	const { createHash } = await import('node:crypto');
	const { readFile } = await import('node:fs/promises');
	const { createRequire } = await import('node:module');
	const bytes = await readFile(addonPath);
	if (createHash('sha256').update(bytes).digest('hex') !== addonSha256) {
		throw new Error('The native helper addon on disk does not match its pinned digest.');
	}
	return createRequire(import.meta.url)(addonPath);
}
