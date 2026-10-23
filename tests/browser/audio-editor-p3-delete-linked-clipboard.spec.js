/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';

for (const remove of [false, true]) test(`copied linked audio remains exportable after ${remove ? 'Delete project' : 'New'}`, async ({ page }) => {
	test.setTimeout(90_000);
	await installLinkedAudioBridge(page, {
		original: createWavFixture({ name: 'Voice.wav', frequency: 330, duration: 1, channelCount: 1 }),
		changed: createWavFixture({ name: 'Other.wav', frequency: 660, duration: 1, channelCount: 1 }),
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const original = await editor.getAttribute('data-project-id');
	await editor.locator('.clip-header').first().click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	if (remove) {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Delete project']);
		const confirmation = page.getByRole('dialog', { name: 'Delete this project?', exact: true });
		await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click();
		await expect(confirmation).toBeHidden();
	} else await chooseCommandAction(page, editor, 'File', 'New');
	await expect(editor).not.toHaveAttribute('data-project-id', original);
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const count = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	await chooseCommandAction(page, editor, 'File', 'Export project file');
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(count + 1);
	const signature = await page.evaluate(() => Array.from(globalThis.__projectBinLinkedAudioFixture.exports.at(-1).slice(0, 4)));
	expect(signature).toEqual([80, 75, 3, 4]);
});
