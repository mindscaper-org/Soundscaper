/* SPDX-License-Identifier: AGPL-3.0-only */

import { test } from './audio-editor-test-fixtures.js';
import { quickTimeTextCases } from '../helpers/mp4-text-metadata-cases.ts';
import { nativeMp4MetadataBatch } from './helpers/mp4-native-metadata-batch.ts';

// Text/locale interpretation matrices also run in their existing Node owners;
// AAC remains native-only, so every original native decode is preserved here.
test('native AAC imports retain every QuickTime text encoding through Save', async ({ page }) => {
	await nativeMp4MetadataBatch(page, await quickTimeTextCases(), false);
});
