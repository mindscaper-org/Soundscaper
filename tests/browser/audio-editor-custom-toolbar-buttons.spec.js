/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	setDocumentTheme,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { TRACK_MENU_TRIGGER } from './helpers/track-menu.js';

const firstTone = createWavFixture({ name: 'custom-button-first.wav', frequency: 330, duration: 8 });
const secondTone = createWavFixture({ name: 'custom-button-second.wav', frequency: 660, duration: 8 });
const UNDO_ACTION = 'action://trackedit/undo';

async function openCustomization(page, editor) {
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	const customization = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
	await expect(customization).toBeVisible();
	return customization;
}

async function openCustomButtonDialog(page, editor, name = null) {
	const customization = await openCustomization(page, editor);
	await customization.getByRole('menuitem', {
		name: name ? `Edit ${name}` : 'Custom button',
		exact: true,
	}).click();
	const dialog = page.getByRole('dialog', { name: 'Custom button', exact: true });
	await expect(dialog).toBeVisible();
	await expect(customization).toBeHidden();
	return dialog;
}

async function configureButton(dialog, { name, action, icon = 'CUT' }) {
	await dialog.getByLabel('Name', { exact: true }).fill(name);
	await selectAction(dialog, action);
	await dialog.getByLabel('Search symbols', { exact: true }).fill(icon);
	await dialog.getByRole('button', { name: icon, exact: true }).click();
}

async function selectAction(dialog, action) {
	await dialog.getByRole('combobox', { name: 'Search actions', exact: true }).fill(action);
	await dialog.getByRole('option').click();
}

async function saveButton(dialog) {
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function selectMiddleOfClip(page, editor, name) {
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Fit project to width']);
	const clip = clipByName(editor, name);
	await clip.scrollIntoViewIfNeeded();
	const bounds = await clip.boundingBox();
	expect(bounds).not.toBeNull();
	const y = bounds.y + bounds.height * 0.55;
	await page.mouse.move(bounds.x + bounds.width * 0.25, y);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.75, y, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
}

async function selectClipTrack(editor, name) {
	const row = clipByName(editor, name).locator('xpath=ancestor::div[@data-track-row]');
	await row.locator('.track-control-panel__track-name-text').click();
	await expect(row.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
	return row;
}

async function expectTrackLockAction(page, row, label) {
	await row.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
	const menu = page.locator('.audio-editor-track-menu');
	await expect(menu).toBeVisible();
	await expect(getMenuItem(menu, label)).toBeEnabled();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
}

test.describe('custom toolbar buttons', () => {
	test('Escape restores the existing action when cancelling an action search', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		let dialog = await openCustomButtonDialog(page, editor);
		await configureButton(dialog, { name: 'Cancel action search', action: UNDO_ACTION });
		await saveButton(dialog);
		dialog = await openCustomButtonDialog(page, editor, 'Cancel action search');
		const search = dialog.getByRole('combobox', { name: 'Search actions', exact: true });
		await search.fill('redo');
		await search.press('Escape');
		await expect(search).toHaveValue(/Undo/u);
		await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
	});

	for (const theme of ['light', 'dark']) test(`saves, cancels, and resets font symbol colors in ${theme} mode`, async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await setDocumentTheme(page, theme);
		let dialog = await openCustomButtonDialog(page, editor);
		await configureButton(dialog, { name: 'Colored undo', action: UNDO_ACTION });
		const color = dialog.getByLabel('Symbol color', { exact: true });
		await expect(color).toBeEnabled();
		await expect(dialog.getByRole('button', { name: 'Use theme color', exact: true })).toBeDisabled();
		await color.fill('#e63946');
		await expect(dialog.getByRole('button', { name: 'CUT', exact: true }).getByText('\uF39A', { exact: true })).toHaveCSS('color', 'rgb(230, 57, 70)');
		await saveButton(dialog);
		let button = editor.getByRole('button', { name: 'Colored undo', exact: true });
		await expect(button.getByText('\uF39A', { exact: true })).toHaveCSS('color', 'rgb(230, 57, 70)');
		const customization = await openCustomization(page, editor);
		await expect(customization.getByRole('checkbox', { name: 'Colored undo', exact: true }).getByText('\uF39A', { exact: true })).toHaveCSS('color', 'rgb(230, 57, 70)');
		await page.keyboard.press('Escape');
		await page.reload();
		editor = await waitForEditor(page);
		button = editor.getByRole('button', { name: 'Colored undo', exact: true });
		await expect(button.getByText('\uF39A', { exact: true })).toHaveCSS('color', 'rgb(230, 57, 70)');
		dialog = await openCustomButtonDialog(page, editor, 'Colored undo');
		await expect(dialog.getByLabel('Symbol color', { exact: true })).toHaveValue('#e63946');
		await dialog.getByLabel('Symbol color', { exact: true }).fill('#123abc');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(button.getByText('\uF39A', { exact: true })).toHaveCSS('color', 'rgb(230, 57, 70)');
		dialog = await openCustomButtonDialog(page, editor, 'Colored undo');
		await expect(dialog.getByLabel('Symbol color', { exact: true })).toHaveValue('#e63946');
		await dialog.getByRole('button', { name: 'Use theme color', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Use theme color', exact: true })).toBeDisabled();
		await saveButton(dialog);
		await page.reload();
		editor = await waitForEditor(page);
		button = editor.getByRole('button', { name: 'Colored undo', exact: true });
		await expect(button.getByText('\uF39A', { exact: true })).not.toHaveAttribute('style');
		const themeColor = await button.evaluate((element) => getComputedStyle(element).color);
		await expect(button.getByText('\uF39A', { exact: true })).toHaveCSS('color', themeColor);
		if (theme === 'light') {
			const retained = await openCustomButtonDialog(page, editor);
			await configureButton(retained, { name: 'Retained undo', action: UNDO_ACTION });
			await saveButton(retained);
			const customization = await openCustomization(page, editor);
			const visibility = customization.getByRole('checkbox', { name: 'Retained undo', exact: true });
			await expect(visibility).toHaveAttribute('aria-checked', 'true');
			await visibility.click();
			await expect(visibility).toHaveAttribute('aria-checked', 'false');
			await expect(editor.getByRole('button', { name: 'Retained undo', exact: true })).toHaveCount(0);
			await visibility.click();
			await expect(visibility).toHaveAttribute('aria-checked', 'true');
			await page.keyboard.press('Escape');
			await expect(customization).toBeHidden();
			const removal = await openCustomButtonDialog(page, editor, 'Colored undo');
			await removal.getByRole('button', { name: 'Remove button', exact: true }).click();
			await expect(removal).toBeHidden();
			await expect(editor.getByRole('button', { name: 'Colored undo', exact: true })).toHaveCount(0);
			await expect(editor.getByRole('button', { name: 'Retained undo', exact: true })).toHaveCount(1);
		}
		expect(errors).toEqual([]);
	});

	test('opens action results on demand or after three characters and keeps keyboard selection in the dialog', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const customization = await openCustomization(page, editor);
		const entries = customization.getByRole('checkbox').or(customization.getByRole('menuitem'));
		await expect(entries.nth(-2)).toHaveAccessibleName('Custom button');
		await expect(entries.nth(-1)).toHaveAccessibleName(/^Dock toolbar/u);
		await page.keyboard.press('Escape');
		const dialog = await openCustomButtonDialog(page, editor);
		const search = dialog.getByRole('combobox', { name: 'Search actions' });
		await expect(search).toHaveAttribute('aria-expanded', 'false');
		await dialog.getByRole('button', { name: 'Show actions' }).click();
		await expect(dialog.getByRole('option').first()).toBeVisible();
		await dialog.getByRole('button', { name: 'Show actions' }).press('Enter');
		await expect(search).toHaveAttribute('aria-expanded', 'false');
		await dialog.getByRole('button', { name: 'Show actions' }).press('Enter');
		await expect(search).toHaveAttribute('aria-expanded', 'true');
		await search.press('Escape');
		await expect(search).toHaveAttribute('aria-expanded', 'false');
		await expect(dialog).toBeVisible();
		await search.fill('a');
		await expect(search).toHaveAttribute('aria-expanded', 'false');
		await search.fill('tra');
		await expect(search).toHaveAttribute('aria-expanded', 'true');
		await search.fill('delete-leave-gap');
		await search.press('ArrowDown');
		await search.press('Enter');
		await expect(search).toHaveValue(/Delete and leave gap/u);
		await expect(search).toHaveAttribute('aria-expanded', 'false');
		await expect(dialog).toBeVisible();
		await search.fill('no-such-custom-action');
		await expect(dialog.getByRole('status')).toHaveText('No matching actions.');
		await search.press('Enter');
		await expect(dialog).toBeVisible();
	});

	for (const [extension, mimeType, buffer] of [
		['svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="red" d="M0 0h16v16H0z"/></svg>')],
		['png', 'image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')],
	]) test(`uploads a ${extension.toUpperCase()} symbol and preserves it through editing and reload`, async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		let dialog = await openCustomButtonDialog(page, editor);
		await configureButton(dialog, { name: `My ${extension} action`, action: UNDO_ACTION });
		const picker = dialog.getByLabel('Choose PNG/SVG symbol');
		await picker.setInputFiles({ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<html/>') });
		await expect(dialog.getByRole('alert')).toHaveText('Choose a valid PNG or SVG image.');
		await picker.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(256 * 1024 + 1) });
		await expect(dialog.getByRole('alert')).toHaveText('Choose a symbol smaller than 256 KB.');
		await picker.setInputFiles({ name: `symbol.${extension}`, mimeType, buffer });
		await expect(dialog.getByRole('button', { name: 'Uploaded symbol', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await expect(dialog.getByLabel('Symbol color', { exact: true })).toBeDisabled();
		await expect(dialog.getByRole('alert')).toHaveCount(0);
		await saveButton(dialog);
		const image = editor.getByRole('button', { name: `My ${extension} action`, exact: true }).locator('img');
		await expect(image).toHaveAttribute('src', `data:${mimeType};base64,${buffer.toString('base64')}`);
		await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
		await page.reload();
		editor = await waitForEditor(page);
		await expect(image).toBeVisible();
		dialog = await openCustomButtonDialog(page, editor, `My ${extension} action`);
		await expect(dialog.getByRole('button', { name: 'Uploaded symbol', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await dialog.getByRole('button', { name: 'CUT', exact: true }).click();
		await expect(dialog.getByLabel('Symbol color', { exact: true })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(image).toBeVisible();
		dialog = await openCustomButtonDialog(page, editor, `My ${extension} action`);
		await dialog.getByRole('button', { name: 'CUT', exact: true }).click();
		await saveButton(dialog);
		await expect(image).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('persists a button and applies its action to each current selection', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		const dialog = await openCustomButtonDialog(page, editor);
		await dialog.getByLabel('Search actions', { exact: true }).fill('leave gap');
		await expect(dialog.getByRole('option', { name: 'Edit › Delete › Delete and leave gap', exact: true })).toBeVisible();
		await configureButton(dialog, { name: 'Lift selected audio', action: 'delete-leave-gap' });
		await saveButton(dialog);
		let button = editor.getByRole('button', { name: 'Lift selected audio', exact: true });
		await expect(button).toBeVisible();
		await expect(button).toContainText('\uF39A');
		await expect(button).toBeDisabled();

		await page.reload();
		editor = await waitForEditor(page);
		button = editor.getByRole('button', { name: 'Lift selected audio', exact: true });
		await expect(button).toBeVisible();
		await expect(button).toContainText('\uF39A');
		await expect(button).toBeDisabled();
		await importFiles(editor, [firstTone, secondTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(0);
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(0);
		await expect(button).toBeDisabled();
		const deleteMenu = await openNestedCommandMenu(page, editor, 'Edit', ['Delete']);
		await expect(getMenuItem(deleteMenu, 'Delete and leave gap')).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await selectMiddleOfClip(page, editor, firstTone.name);
		await expect(button).toBeEnabled();
		await button.click();
		await expect(clipByName(editor, firstTone.name)).toHaveCount(2);
		await expect(clipByName(editor, secondTone.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, firstTone.name)).toHaveCount(1);

		await selectMiddleOfClip(page, editor, secondTone.name);
		await button.click();
		await expect(clipByName(editor, firstTone.name)).toHaveCount(1);
		await expect(clipByName(editor, secondTone.name)).toHaveCount(2);
		expect(errors).toEqual([]);
	});

	test('binds a context menu command to the current track as its target changes', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const dialog = await openCustomButtonDialog(page, editor);
		await configureButton(dialog, { name: 'Toggle current track lock', action: 'track-lock-toggle', icon: 'LOCK_CLOSED' });
		await saveButton(dialog);
		await importFiles(editor, [firstTone, secondTone]);
		const button = editor.getByRole('button', { name: 'Toggle current track lock', exact: true });
		const firstRow = await selectClipTrack(editor, firstTone.name);
		await expect(button).toBeEnabled();
		await button.click();
		await expectTrackLockAction(page, firstRow, 'Unlock track');
		const secondRow = await selectClipTrack(editor, secondTone.name);
		await expectTrackLockAction(page, secondRow, 'Lock track');
		await button.click();
		await expectTrackLockAction(page, secondRow, 'Unlock track');

		await selectClipTrack(editor, firstTone.name);
		await button.click();
		await expectTrackLockAction(page, firstRow, 'Lock track');
		await expectTrackLockAction(page, secondRow, 'Unlock track');
		expect(errors).toEqual([]);
	});

});
