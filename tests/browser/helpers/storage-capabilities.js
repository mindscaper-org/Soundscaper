/* SPDX-License-Identifier: AGPL-3.0-only */

/** Some automation contexts expose OPFS methods without an accessible filesystem. */
export async function originPrivateFileSystemAvailable(page) {
	return page.evaluate(async () => {
		if (typeof navigator.storage?.getDirectory !== 'function') return false;
		try {
			await navigator.storage.getDirectory();
			return true;
		} catch (error) {
			if (['UnknownError', 'SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) return false;
			throw error;
		}
	});
}
