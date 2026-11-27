/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';

export function writeFileSizeLimitedPeer(path: string): Promise<void> {
	// Limit only peer writes to 1 MiB. Ignore SIGXFSZ so its file writer sees the failure.
	return writeFile(path, '#!/bin/bash\ntrap \'\' XFSZ\nulimit -f 1024\nexec "$SOUNDSCAPER_TRACKTION_TEST_PEER" "$@"\n', { mode: 0o700 });
}
