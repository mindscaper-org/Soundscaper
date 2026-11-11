/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { SHERPA_ENHANCEMENT_ARTIFACTS } from './assistance-sherpa-enhancement-contract.ts';

export async function authenticateAiDenoiseModel(path: string): Promise<void> {
	const before = await lstat(path, { bigint: true });
	if (!before.isFile() || before.isSymbolicLink() || before.size > 32n * 1024n ** 2n) throw new Error('Invalid denoising artifact.');
	const hash = createHash('sha256');
	for await (const bytes of createReadStream(path)) hash.update(bytes);
	const after = await lstat(path, { bigint: true });
	if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
		|| before.size !== after.size || before.mtimeNs !== after.mtimeNs
		|| hash.digest('hex') !== SHERPA_ENHANCEMENT_ARTIFACTS['dpdfnet2-48khz'][0].sha256) throw new Error('Denoising artifact authentication failed.');
}
