/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { nestedDawprojectFadeFile } from '../helpers/dawproject-nested-fade-fixture.ts';

for (const fadeOut of [false, true]) test(`DAWproject nested fade PCM retains the ${fadeOut ? 'cubic' : 'quadratic'} gain product`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await nestedDawprojectFadeFile(fadeOut ? ['in', 'in', 'out'] : ['in', 'in']);
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.'); await expect(editor).toHaveAttribute('data-clip-count', '1');
	const samples = await exportSamples(page, editor);
	const actual = samples[36_000] / samples[60_000];
	const expected = fadeOut ? 0.225 / ((1.25 / 1.5) ** 2 * (1.75 / 2.5)) : 0.25 / ((1.25 / 1.5) ** 2);
	expect(Math.abs(actual - expected)).toBeLessThan(0.001);
});
