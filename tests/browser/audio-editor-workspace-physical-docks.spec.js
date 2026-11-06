/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, dockWorkspacePanel, getMenuItem } from './audio-editor-test-helpers.js';
import { localeCopy } from './helpers/locale-copy.js';

for (const locale of ['en', 'ar']) for (const side of ['left', 'right']) test(`${locale} workspace ${side} drop retains its physical side without changing panel direction`, async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	const copy = localeCopy(locale);
	const editor = await bootEditor(page, `/embed/${locale}/`);
	const panel = editor.locator('[data-workspace-panel="project-bin"]');
	if (!await panel.count()) {
		await editor.getByRole('menubar').getByRole('menuitem', { name: copy.windowMenu, exact: true }).click();
		await getMenuItem(page.getByRole('menu', { name: copy.windowMenu, exact: true }), copy.panelProjectBin).click();
	}
	await expect(panel).toBeVisible();
	// Empty both edge docks so each physical drop target is offered.
	for (const [id, label] of [['playback-meter', copy.panelPlaybackMeter], ['recording-meter', copy.panelRecordingMeter]]) {
		if (!await editor.locator(`[data-workspace-panel="${id}"]`).count()) continue;
		await editor.getByRole('menubar').getByRole('menuitem', { name: copy.windowMenu, exact: true }).click();
		await getMenuItem(page.getByRole('menu', { name: copy.windowMenu, exact: true }), label).click();
		await expect(editor.locator(`[data-workspace-panel="${id}"]`)).toHaveCount(0);
	}
	await expect(panel).toHaveCSS('direction', locale === 'ar' ? 'rtl' : 'ltr');
	const main = editor.locator('.kw-audio-editor__workspace-main').first();
	const assertSide = async (edge) => {
		const [panelBox, mainBox] = await Promise.all([requiredBounds(panel), requiredBounds(main)]);
		if (edge === 'left') expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(mainBox.x + 1);
		else expect(panelBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width - 1);
	};
	// Start on the other side, then use the visible physical-edge target.
	await dockWorkspacePanel(editor, 'project-bin', side === 'left' ? 'right' : 'left', copy);
	const handle = await requiredBounds(panel.locator('[data-workspace-panel-drag-handle="project-bin"]'));
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	try {
		await page.mouse.move(handle.x + handle.width / 2 + 12, handle.y + handle.height / 2 + 12, { steps: 4 });
		await expect(editor.locator('[data-workspace-drop-targets]')).toHaveClass(/--active/u);
		const target = await requiredBounds(editor.locator(`[data-workspace-drop-target="${side}"]`));
		const workspace = await requiredBounds(editor.locator('.kw-audio-editor__workspace').first());
		if (side === 'left') expect(target.x + target.width).toBeLessThan(workspace.x + workspace.width / 2);
		else expect(target.x).toBeGreaterThan(workspace.x + workspace.width / 2);
		await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
		await page.mouse.up();
	} finally { await page.mouse.up(); }
	await expect(editor.locator(`[data-panel-dock="${side}"] [data-workspace-panel="project-bin"]`)).toBeVisible();
	await assertSide(side);
	await expect(panel).toHaveCSS('direction', locale === 'ar' ? 'rtl' : 'ltr');
	const dock = editor.locator(`[data-panel-dock="${side}"]`);
	const resize = dock.locator(`[data-workspace-dock-resize-handle="${side}"]`);
	const [dockBox, resizeBox] = await Promise.all([requiredBounds(dock), requiredBounds(resize)]);
	if (side === 'left') expect(resizeBox.x).toBeGreaterThan(dockBox.x + dockBox.width / 2);
	else expect(resizeBox.x + resizeBox.width).toBeLessThan(dockBox.x + dockBox.width / 2);
	await resize.press(side === 'left' ? 'ArrowRight' : 'ArrowLeft');
	await expect.poll(async () => (await requiredBounds(dock)).width).toBeGreaterThan(dockBox.width);
	await assertSide(side);
	// The existing overflow actions use the same physical dock policy.
	await dockWorkspacePanel(editor, 'project-bin', 'left', copy);
	await assertSide('left');
	await dockWorkspacePanel(editor, 'project-bin', 'right', copy);
	await assertSide('right');
});

async function requiredBounds(locator) {
	const bounds = await locator.boundingBox();
	expect(bounds).not.toBeNull();
	return bounds;
}
