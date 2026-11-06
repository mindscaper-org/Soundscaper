/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';

for (const anchor of ['top', 'center']) test(`Source ruler ${anchor} popup stays above the Selection toolbar`, async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'Source popup.wav', sampleRate: 48000, frequency: 3000, duration: 1, channelCount: 1 });
	await importFiles(editor, [file]);
	const panel = await openSourceMonitor(page, editor, clipByName(editor, file.name));
	const vertical = panel.getByRole('region', { name: 'Source vertical ruler', exact: true });
	const workspace = editor.locator('.kw-audio-editor__workspace');
	const amplitude = vertical.locator('.vertical-ruler').first();
	const height = async () => (await amplitude.boundingBox()).height;
	await expect(workspace).toHaveCSS('z-index', '0');
	const open = async position => {
		const box = await vertical.boundingBox();
		if (!box) throw new Error('Expected the visible Source vertical ruler.');
		const point = { x: box.x + box.width / 2, y: box.y + (position === 'top' ? 4 : box.height / 2) };
		expect(await vertical.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
		await page.mouse.click(point.x, point.y, { button: 'right' });
		const menu = page.getByRole('menu', { name: '', exact: true });
		await expect(menu).toBeVisible();
		await expect.poll(() => menu.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
	};
	const clickAction = async label => {
		const item = page.getByRole('menuitem', { name: label, exact: true });
		const box = await item.boundingBox();
		if (!box) throw new Error(`Expected the offered ${label} action.`);
		const viewport = page.viewportSize();
		if (!viewport) throw new Error('Expected the supported viewport.');
		const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(viewport.width);
		expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(viewport.height);
		await page.mouse.click(point.x, point.y);
		await expect(item).toBeHidden();
	};
	const initial = await height();
	await open('top');
	await clickAction('Zoom in');
	await expect.poll(height).toBeGreaterThan(initial);
	const zoomed = await height();
	const scrollState = () => vertical.evaluate(element => {
		const owners = [];
		for (let node = element; node; node = node.parentElement) owners.push([node.scrollLeft, node.scrollTop]);
		return { window: [window.scrollX, window.scrollY], owners };
	});
	const beforeScroll = await scrollState();
	await open(anchor);
	expect(await scrollState()).toEqual(beforeScroll);
	await clickAction('Zoom out');
	await expect.poll(height).toBeLessThan(zoomed);
	await expect(workspace).toHaveCSS('z-index', '0');
});
