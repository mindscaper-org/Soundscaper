/* SPDX-License-Identifier: AGPL-3.0-only */
import { rename } from 'node:fs/promises';
import type { MotionSaveDirectoryIdentity, MotionSaveFingerprint } from './motion-save-file-identity.ts';

export interface MotionSaveReplacementInput {
	readonly source: string;
	readonly destination: string;
	readonly parent: MotionSaveDirectoryIdentity;
	readonly candidate: MotionSaveFingerprint;
	readonly expected: MotionSaveFingerprint | null;
}
export type MotionSaveFileReplacement = (input: MotionSaveReplacementInput) => Promise<void>;

/** Windows supplies its handle-based replacement; POSIX retains native rename. */
export async function replaceMotionSaveFile(input: MotionSaveReplacementInput, replace?: MotionSaveFileReplacement): Promise<void> {
	if (replace) await replace(input);
	else await rename(input.source, input.destination);
}
