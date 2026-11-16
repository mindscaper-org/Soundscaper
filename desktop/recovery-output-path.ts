/* SPDX-License-Identifier: AGPL-3.0-only */

import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Input { readonly owner: object; readonly path: string; readonly sourcePath?: string }

/** Recovery publication can never overwrite an input, including through another hard link. */
export async function assertRecoveryOutputPath(output: string, owner: object, entries: Iterable<Input>): Promise<void> {
	const canonical = async (path: string): Promise<string> => {
		try { return await realpath(path); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return resolve(path); }
	};
	const destination = await canonical(output);
	let outputStat;
	try { outputStat = await stat(output, { bigint: true }); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
	for (const entry of entries) {
		if (entry.owner !== owner) continue;
		const source = entry.sourcePath ?? entry.path;
		if (destination === await canonical(source)) throw new Error('Recovery must save a new file. The original project is protected.');
		if (outputStat) {
			const inputStat = await stat(source, { bigint: true });
			if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) throw new Error('Recovery cannot replace another name for the original project.');
		}
	}
}
