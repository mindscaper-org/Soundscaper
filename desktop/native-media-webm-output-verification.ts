/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NativeMediaHostInvocation } from './native-media-helper-job.ts';

const PROFILES = new Set(['encode-webm-vp8', 'encode-webm-vp9', 'encode-webm-vp9-alpha', 'encode-webm-av1']);

/** Read back generated WebM bytes without granting reads of the destination directory. */
export async function prepareNativeWebmOutputVerification(original: NativeMediaHostInvocation) {
	const output = original.temporaryOutputPath;
	const plan = original.plan;
	const candidate = output && plan && (original.operation === 'media-encode' || original.operation === 'media-render')
		? JSON.parse(String(await readFile(plan.path))) as { deliveryProfile?: unknown } : null;
	const directory = output && typeof candidate?.deliveryProfile === 'string' && PROFILES.has(candidate.deliveryProfile)
		? await mkdtemp(join(dirname(output), '.framescaper-webm-')) : null;
	const temporary = directory ? join(directory, 'verified.webm') : null;
	return {
		directory,
		invocation: temporary ? { ...original, destinationRoot: directory, temporaryOutputPath: temporary } : original,
		async publish(): Promise<void> {
			if (!temporary || !output) return;
			const metadata = await lstat(temporary);
			if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > original.maximumOutputBytes) {
				throw new Error('The isolated encoder produced an invalid WebM output.');
			}
			await copyFile(temporary, output, constants.COPYFILE_EXCL);
		},
		async close(): Promise<void> {
			if (directory) await rm(directory, { recursive: true, force: true });
		},
	};
}
