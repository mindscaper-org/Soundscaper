/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('live Spectrum includes a surround recording with signal only in its rear channels', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Rear programme.wav', frequency: 1100,
		duration: 10, channelCount: 6, channelAmplitudes: [0, 0, 0, 0, .5, .5] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const analysis = editor.locator('[data-workspace-panel="analysis"]');
	await analysis.locator('[data-analysis-section="spectrum"] summary').click();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const legend = analysis.locator('[data-analysis-report="spectrum"] li');
	await expect(legend).toContainText(/110\d\.\d Hz/);
	await expect(legend).not.toContainText('−∞');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
