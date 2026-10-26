/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

test('the grading file menu accepts a standard CUBE with an empty optional title', async ({ page }) => {
	const body = ['TITLE ""', 'LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0',
		'0 0 1', '1 0 1', '0 1 1', '1 1 1', ''].join('\n');
	const native = await installNativeCaptionSidecar(page, 'untitled.cube', body);
	try {
		const editor = await bootEditor(page, '/framescaper/en/');
		test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Native LUT storage requires durable Blob support.');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
		const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
		await clip.press('Enter'); await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
		const inspector = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await inspector.getByRole('spinbutton', { name: 'Opacity', exact: true }).fill('0.5');
		await inspector.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(inspector.getByRole('status').last()).toHaveText('Selected visual updated.');
		await inspector.getByRole('button', { name: 'Close', exact: true }).click(); await expect(inspector).toBeHidden();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Grading & Finishing Presets']);
		const dialog = page.getByRole('dialog', { name: 'Grading & Finishing Presets', exact: true });
		await dialog.getByRole('button', { name: 'Choose .cube LUT', exact: true }).click();
		await expect.poll(() => native.releases.length).toBe(1);
		await expect(dialog.getByRole('status')).toHaveText(/^Presentation .+: [0-9a-f]{12}$/u);
		const saved = JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
		expect(saved.videoVisualPresentations).toHaveLength(1);
		expect(saved.videoVisualPresentations[0].opacity).toBe(0.5);
		expect(saved.videoVisualPresentations[0].grade.lut.size).toBe(2);
	} finally { await native.close(); }
});
