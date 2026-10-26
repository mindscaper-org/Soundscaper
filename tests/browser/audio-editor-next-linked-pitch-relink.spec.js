/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor, openClipProperties, closeClipProperties, openExportDialog, chooseDropdown, closeDialog, collectClientErrors } from './audio-editor-test-helpers.js';
import { clearSourceProvenance, installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';

test('changed-content linked WAV relink retires the old pitched audio cache through reload', async ({ page }) => {
	test.setTimeout(120_000);
	const errors = collectClientErrors(page);
	await installLinkedAudioBridge(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	await clearSourceProvenance(page, projectId);
	await page.reload(); await waitForEditor(page);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first(), { additional: false });
	const pitch = properties.getByRole('textbox', { name: 'Pitch', exact: true });
	await pitch.fill('12'); await pitch.press('Enter'); await closeClipProperties(properties);
	await expectPitch(page, editor, 660);
	await page.evaluate(() => { globalThis.__projectBinLinkedAudioFixture.next = 'accepted'; });
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
	const changed = page.locator('[data-project-bin-relink-changed-dialog]');
	await expect(changed).toBeVisible();
	await changed.getByRole('button', { name: 'Replace', exact: true }).click();
	await expect(changed).toBeHidden();
	await expectPitch(page, editor, 1320);
	await page.reload(); await waitForEditor(page);
	await expectPitch(page, editor, 1320);
	expect(errors).toEqual([]);
});

async function expectPitch(page, editor, frequency) {
	const count = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length), { timeout: 30_000 }).toBe(count + 1);
	await closeDialog(dialog);
	const actual = await page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports.at(-1);
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(bytes.buffer.slice(0));
			const samples = audio.getChannelData(0);
			let crossings = 0;
			const start = Math.floor(samples.length / 4), end = Math.floor(samples.length * 3 / 4);
			for (let frame = start + 1; frame < end; frame++) if (samples[frame - 1] < 0 && samples[frame] >= 0) crossings++;
			return crossings * audio.sampleRate / (end - start);
		} finally { await context.close(); }
	});
	expect(Math.abs(actual - frequency), `exported pitch ${actual}Hz, expected ${frequency}Hz`).toBeLessThan(8);
}
