/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture, readFile } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseCommandAction, closeDialog } from './audio-editor-test-helpers.js';

for (const reopen of [false, true]) test(`repeating contrast with ${reopen ? 'closed' : 'already-open'} repeat window measures the newly selected range`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const fixture = createWavFixture({ name: 'repeat-contrast.wav', frequency: 440, duration: 2, channelCount: 1 });
	for (let frame = 48_000; frame < 96_000; frame += 1) fixture.buffer.writeInt16LE(Math.round(fixture.buffer.readInt16LE(44 + frame * 2) / 10), 44 + frame * 2);
	await importFiles(editor, [fixture]);
	await selectRange(page, editor, 24, 108);
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	let dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	await dialog.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	const foreground = () => dialog.locator('[data-analysis-report="contrast"] > p').first();
	await expect(foreground()).toContainText('dBFS');
	const initialText = await foreground().innerText();
	const initial = await exportReport(page, dialog);
	await selectRange(page, editor, 144, 228);
	await chooseCommandAction(page, editor, 'Analyze', 'Repeat last analyzer');
	await expect(dialog).toHaveAttribute('data-analysis-repeat', 'true');
	await expect(foreground()).not.toHaveText(initialText);
	const firstRepeat = await exportReport(page, dialog);
	expect(firstRepeat.report.foreground.startFrame).toBeGreaterThan(initial.report.foreground.startFrame);
	if (reopen) await closeDialog(dialog);
	await selectRange(page, editor, 24, 108);
	await chooseCommandAction(page, editor, 'Analyze', 'Repeat last analyzer');
	dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	await expect(dialog).toBeVisible();
	await expect(foreground()).toHaveText(initialText);
	const secondRepeat = await exportReport(page, dialog);
	expect(secondRepeat.report.foreground).toMatchObject({ startFrame: initial.report.foreground.startFrame, endFrame: initial.report.foreground.endFrame });
	expect(secondRepeat.report.foreground.rmsDb).toBeCloseTo(initial.report.foreground.rmsDb, 5);
});

async function selectRange(page, editor, start, end) {
	const ruler = editor.locator('[data-ruler-interaction]');
	const box = await ruler.boundingBox(); expect(box).not.toBeNull();
	await page.mouse.move(box.x + start, box.y + box.height * .8);
	await page.mouse.down();
	await page.mouse.move(box.x + end, box.y + box.height * .8, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).not.toHaveCount(0);
}
async function exportReport(page, dialog) {
	const waiting = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await waiting;
	const path = await download.path(); expect(path).not.toBeNull();
	return JSON.parse(await readFile(path, 'utf8'));
}
