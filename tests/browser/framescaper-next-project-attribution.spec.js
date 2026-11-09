/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';

test('native image clips retain usable attribution and original import identity', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	{
		const pending = page.waitForEvent('filechooser'); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		await (await pending).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
	}
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-metadata-editor]'); await metadata.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const report = metadata.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await expect(report.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled();
	await expect(report).not.toContainText('invalid source data');
	const pending = page.waitForEvent('download'); await report.getByRole('button', { name: 'Export CSV', exact: true }).click();
	const csv = new TextDecoder().decode(await downloadBytes(await pending));
	expect(csv).toContain('use_start_timecode');
	expect(csv).toContain('"poster"'); expect(csv).toContain('00:00:05.000');
	expect(csv).toContain('poster.png'); expect(csv).toContain('local-file');
	expect(csv).not.toContain('predates provenance tracking');
});
