/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

for (const [product, route] of [['soundscaper', '/embed/en/'], ['framescaper', '/framescaper/embed/en/']]) {
	test(`${product} tooltips show current shortcuts on toolbar buttons and menu commands`, async ({ page }) => {
		const editor = await bootEditor(page, route);
		const tooltip = editor.locator('.kw-audio-editor__button-tooltip');
		await editor.getByRole('button', { name: 'Play', exact: true }).hover();
		await expect(tooltip).toHaveText('Play (P)');
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).hover();
		await expect(tooltip).toHaveText('Zoom in (Ctrl+=)');
		if (product === 'soundscaper') {
			await editor.locator('[data-track-row]').first().getByRole('button', { name: 'Mute', exact: true }).hover();
			await expect(tooltip).toHaveText('Mute (Shift+U)');
			await editor.locator('[data-track-row]').first().getByRole('button', { name: 'Effects', exact: true }).hover();
			await expect(tooltip).toHaveText('Effects (E)');
		}
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).hover();
		await expect(tooltip).toHaveText('Customize toolbar');
		await editor.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
		const menu = editor.locator('.kw-audio-editor__application-menu');
		await menu.getByRole('menuitem', { name: /^New Ctrl/u }).hover();
		const explanation = page.locator('.menu-tooltip');
		await expect(explanation).toContainText('Start an empty timeline');
		await expect(explanation.locator('kbd')).toHaveText('Ctrl+N');
	});
}

test('a button tooltip keeps its width when the button is at the viewport edge', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const button = editor.getByRole('button', { name: 'Customize toolbar', exact: true });
	const tooltip = editor.getByRole('tooltip', { name: 'Customize toolbar', exact: true });
	await button.hover();
	await expect(tooltip).toBeVisible();
	const initial = await tooltip.boundingBox();
	await page.mouse.move(0, 0);
	await expect(tooltip).toHaveCount(0);
	await button.evaluate(element => Object.assign(element.style, { position: 'fixed', top: '20px', right: '0', zIndex: '1000' }));
	await button.hover();
	await expect(tooltip).toBeVisible();
	const atEdge = await tooltip.boundingBox();
	expect(atEdge.width).toBeCloseTo(initial.width, 1);
	expect(atEdge.x + atEdge.width).toBeLessThanOrEqual(page.viewportSize().width);
	expect(errors).toEqual([]);
});

test('button and menu tooltips follow shortcut reassignment and removal', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const assign = async (binding) => {
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Zoom in');
		const row = preferences.getByRole('group', { name: 'Zoom in', exact: true }).locator('..');
		await row.getByRole('textbox').first().fill(binding);
		await row.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	};
	await assign('Ctrl+Alt+9');
	await editor.getByRole('button', { name: 'Zoom in', exact: true }).hover();
	await expect(editor.locator('.kw-audio-editor__button-tooltip')).toHaveText('Zoom in (Ctrl+Alt+9)');
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
	await editor.getByRole('menuitem', { name: /^Zoom ▸$/u }).hover();
	const zoom = editor.getByRole('menuitem', { name: /^Zoom in/u });
	await zoom.hover();
	await expect(page.locator('.menu-tooltip kbd')).toHaveText('Ctrl+Alt+9');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await assign('');
	await editor.getByRole('button', { name: 'Zoom in', exact: true }).hover();
	await expect(editor.locator('.kw-audio-editor__button-tooltip')).toHaveText('Zoom in');
});
