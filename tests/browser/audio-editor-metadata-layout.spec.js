/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const width of [1280, 800]) {
	test(`metadata fields keep aligned input columns at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const common = editor.getByRole('tabpanel', { name: 'General', exact: true });
		await expectAlignedFields(common.getByRole('textbox'));

		await editor.getByRole('tab', { name: 'ID3', exact: true }).click();
		const id3 = editor.getByRole('tabpanel', { name: 'ID3', exact: true });
		await expectAlignedFields(id3.getByRole('textbox'));

		await editor.getByRole('tab', { name: 'BEXT', exact: true }).click();
		const bext = editor.getByRole('tabpanel', { name: 'BEXT', exact: true });
		await expectAlignedFields(bext.getByRole('textbox'));
	});
}

async function expectAlignedFields(fields) {
	await expect(fields.first()).toBeVisible();
	const bounds = await fields.evaluateAll(elements => elements.map(element => {
		const { x, width } = element.getBoundingClientRect();
		return { x, width };
	}));
	expect(bounds.length).toBeGreaterThan(1);
	for (const boundsOfField of bounds) {
		expect(Math.abs(boundsOfField.x - bounds[0].x)).toBeLessThanOrEqual(1);
		expect(Math.abs(boundsOfField.width - bounds[0].width)).toBeLessThanOrEqual(1);
		expect(boundsOfField.width).toBeGreaterThan(0);
	}
}
