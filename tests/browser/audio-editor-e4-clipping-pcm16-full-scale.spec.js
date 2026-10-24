/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const [sample, regionCount] of [[32_767, 1], [-32_768, 1], [32_766, 0]]) {
	test(`Find clipping reports signed PCM16 full scale ${sample}`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [{ name: `PCM16 ${sample}.wav`, mimeType: 'audio/wav', buffer: pcm16Recording(sample) }]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseCommandAction(page, editor, 'Analyze', 'Find clipping');
		const report = page.getByRole('dialog', { name: 'Find clipping', exact: true }).locator('[data-analysis-report="clipping"]');
		await expect(report).toBeVisible();
		await expect(report.locator('li')).toHaveCount(regionCount);
		if (!regionCount) await expect(report).toContainText('No clipping regions');
	});
}

function pcm16Recording(sample) {
	const frames = 48_000, channels = 2;
	const bytes = Buffer.alloc(44 + frames * channels * 2);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
	bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(48_000 * channels * 2, 28);
	bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	for (let frame = 12_000; frame < 12_004; frame++) {
		for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(sample, 44 + (frame * channels + channel) * 2);
	}
	return bytes;
}
