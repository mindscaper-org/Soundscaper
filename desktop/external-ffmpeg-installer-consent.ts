/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Consume the installer opt-in without making an unchecked install discover executables. */
export async function consumeExternalFfmpegInstallerConsent(userDataPath: string): Promise<boolean> {
	const path = join(userDataPath, 'ffmpeg-installer-consent');
	try {
		const before = await lstat(path);
		if (!before.isFile() || before.size !== 2) return false;
		const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try {
			const current = await file.stat();
			if (!current.isFile() || current.size !== 2 || before.dev !== current.dev || before.ino !== current.ino) return false;
			const contents = Buffer.alloc(2);
			const { bytesRead } = await file.read(contents, 0, 2, 0);
			if (bytesRead !== 2 || contents.toString('utf8') !== '1\n') return false;
		} finally { await file.close(); }
		await unlink(path);
		return true;
	} catch { return false; }
}
