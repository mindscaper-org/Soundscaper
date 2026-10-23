/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { quickTimeTextM4aFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';

for (const encoding of ['macintosh', 'utf16', 'utf8', 'ffmpeg', 'ffmpeg-unlabelled']) test(`File Import retains localized QuickTime ${encoding} text`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await quickTimeTextM4aFixture(encoding);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	expect(document.sources[0]).toMatchObject({ channelCount: 2, sampleRate: 44_100 });
	expect(document.sources[0].frameCount).toBeGreaterThan(2000);
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized).toMatchObject({ title: 'Café', comment: 'After title' });
	expect(contribution.metadata.raw['©nam']).toEqual({ '0.language': encoding === 'macintosh' ? '1' : encoding === 'ffmpeg-unlabelled' ? '0' : '5575', '0.text': 'Café', '1.language': '5575', '1.text': 'Second title' });
});
