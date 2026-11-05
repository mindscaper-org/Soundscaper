/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMotionscaperNativeFileReplacement } from '../../desktop/motionscaper-native-file-replacement.ts';
import { replaceMotionSaveFile, type MotionSaveFileReplacement } from '../../desktop/motion-save-file-replacement.ts';
import { motionSaveFingerprint } from '../../desktop/motion-save-file-identity.ts';
import { captureMotionSaveDirectory } from '../../desktop/motion-save-publication-journal.ts';

/** Native Windows regressions require a genuine current staged helper, never a mocked replacement. */
export async function motionSaveReplacementForTest(): Promise<MotionSaveFileReplacement | undefined> {
	if (process.platform !== 'win32') return undefined;
	const stage = process.env.SCAPE_TEST_MOTION_NATIVE_STAGE;
	if (!stage) throw new Error('Set SCAPE_TEST_MOTION_NATIVE_STAGE to the authenticated current native stage for Windows snapshot replacement tests.');
	const manifest: unknown = JSON.parse(await readFile(join(stage, 'app/desktop/native-payload.json'), 'utf8'));
	const replace = await createMotionscaperNativeFileReplacement(stage, manifest);
	if (!replace) throw new Error('Windows snapshot replacement tests require their staged native helper.');
	return replace;
}

export async function replaceWatchedMotionFileForTest(source: string, destination: string): Promise<void> {
	await replaceMotionSaveFile({ source, destination, parent: await captureMotionSaveDirectory(destination),
		candidate: motionSaveFingerprint(await lstat(source, { bigint: true })),
		expected: motionSaveFingerprint(await lstat(destination, { bigint: true })) }, await motionSaveReplacementForTest());
}
