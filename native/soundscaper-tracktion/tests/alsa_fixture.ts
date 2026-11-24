/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';

export async function writeAlsaOutputFixture(config: string, output: string): Promise<void> {
	await writeFile(config, `
pcm.null { type null }
pcm.!default {
	type file
	slave.pcm "null"
	file ${JSON.stringify(output)}
	format "raw"
	hint.description "Soundscaper test output"
}
`);
}
