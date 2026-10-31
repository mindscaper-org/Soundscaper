/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const kind of ['maximum-frequency', 'start-time']) {
	test(`a configured command from a spectral ${kind} handle preserves its band`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
		const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
		await row.getByRole('textbox').first().fill('Ctrl+Alt+Right');
		await row.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await clipByName(editor, toneA.name).locator('.clip-header').click();
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
		const surface = editor.getByRole('button', { name: 'Spectral brush', exact: true });
		const brush = await surface.boundingBox();
		expect(brush).not.toBeNull();
		const start = { x: brush.x + 200, y: brush.y + brush.height / 3 };
		await expect(surface).toBeEnabled();
		await surface.hover({ position: { x: 200, y: brush.height / 3 } });
		expect(await surface.evaluate((element, point) => (
			element.ownerDocument.elementFromPoint(point.x, point.y) === element
		), start)).toBe(true);
		await page.mouse.down();
		const draft = surface.locator('.audio-editor-spectral-brush__preview');
		await expect(draft).toBeVisible();
		await page.mouse.move(brush.x + 235, brush.y + brush.height / 3 + 30);
		await expect(draft).toBeVisible();
		await page.mouse.up();
		const handle = editor.locator(`.audio-editor-spectral-selection__handle--${kind === 'start-time' ? 'time-start' : 'frequency-maximum'}`);
		await expect(handle).toBeVisible();
		const before = await handle.getAttribute('aria-valuenow');
		await handle.focus();
		await handle.press('Control+Alt+ArrowRight');
		await expect(editor.locator('[data-label-track]')).toHaveCount(1);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);
		await expect(handle).toHaveAttribute('aria-valuenow', before);
		await handle.focus();
		await handle.press('ArrowRight');
		await expect(handle).not.toHaveAttribute('aria-valuenow', before);
	});
}
