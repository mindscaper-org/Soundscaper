/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

async function newProgram(page) {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	return manager;
}

async function reimportProgram(page) {
	const manager = await newProgram(page);
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("sound.log.info('hello');");
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		manager.getByRole('button', { name: 'Export program', exact: true }).click(),
	]);
	const file = await download.path();
	expect(file).not.toBeNull();
	await manager.getByRole('button', { name: 'Delete program', exact: true }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		manager.getByRole('button', { name: 'Import program', exact: true }).click(),
	]);
	await chooser.setFiles(file);
	return manager;
}

test('an imported program has an accessible Run macro button without a review panel', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const manager = await reimportProgram(page);
	await expect(manager.getByRole('checkbox')).toHaveCount(0);
	const run = manager.getByRole('button', { name: 'Run macro', exact: true });
	await run.scrollIntoViewIfNeeded();
	const reachable = await run.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return element.contains(element.ownerDocument.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
	});
	expect(reachable).toBe(true);
	await expect(run).toBeEnabled();
});

test('Escape then Tab leaves the program textarea without closing the palette', async ({ page }) => {
	const manager = await newProgram(page);
	const program = manager.getByRole('textbox', { name: 'Program', exact: true });
	await program.focus();
	await program.press('Escape');
	await expect(manager).toBeVisible();
	await program.press('Tab');
	await expect(program).not.toBeFocused();
	await expect(manager).toBeVisible();
});
