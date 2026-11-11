/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';

/** Publish every chunk before returning, including when the run is interrupted. */
export function createCheckAllLog(file: string): Writable {
	const directory = dirname(file);
	mkdirSync(directory, { recursive: true });
	writeFileSync(file, '');
	return new Writable({
		write(chunk: Buffer, _encoding, callback) {
			try {
				// Nested runners can clear test-results while this command is active.
				mkdirSync(directory, { recursive: true });
				appendFileSync(file, chunk);
				callback();
			} catch (error) { callback(error as Error); }
		},
	});
}
