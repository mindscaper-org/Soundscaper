/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';

export function writeFileSizeLimitedPeer(path: string, kibibytes = 1024): Promise<void> {
	if (!Number.isSafeInteger(kibibytes) || kibibytes < 1) throw new RangeError('Invalid peer write limit.');
	// Ignore SIGXFSZ so the peer's file writer handles its own short write.
	return writeFile(path, `#!/bin/bash\ntrap '' XFSZ\nulimit -f ${kibibytes}\nexec "$SOUNDSCAPER_TRACKTION_TEST_PEER" "$@"\n`, { mode: 0o700 });
}
