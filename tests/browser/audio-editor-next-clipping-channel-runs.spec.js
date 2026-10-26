/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const consecutive of [false, true]) test(`Find clipping ${consecutive ? 'finds real' : 'ignores alternating isolated'} channel runs`, async ({ page }) => {
	const channels = [new Float32Array(4_800), new Float32Array(4_800)];
	for (let index = 0; index < 6; index++) channels[consecutive ? Math.floor(index / 3) : index % 2][100 + index] = 1.25;
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Stereo peaks.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav(channels, { sampleRate: 48_000, bitDepth: 32, float: true, dither: false })) }]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Find clipping');
	const report = page.getByRole('dialog', { name: 'Find clipping', exact: true }).locator('[data-analysis-report="clipping"]');
	await expect(report).toBeVisible();
	await expect(report.locator('li')).toHaveCount(consecutive ? 1 : 0);
	if (!consecutive) await expect(report).toContainText('No clipping regions');
});
