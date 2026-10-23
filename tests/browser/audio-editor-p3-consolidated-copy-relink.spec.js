/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseDropdown, closeDialog, openExportDialog, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { clearSourceProvenance, installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const choice of ['changed', 'exact']) test(`consolidated copies preserve original Relink custody; choice=${choice}`, async ({ page }) => {
	test.setTimeout(90_000);
	await installLinkedAudioBridge(page, {
		original: createWavFixture({ name: 'Original.wav', frequency: 330, duration: 2, channelCount: 1 }),
		changed: createWavFixture({ name: 'Changed.wav', frequency: 660, duration: 2, channelCount: 1 }),
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const originalId = await editor.getAttribute('data-project-id');
	const title = await editor.locator('[data-project-name]').innerText(); await clearSourceProvenance(page, originalId);
	await page.reload(); await waitForEditor(page); await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
	await expect(editor).not.toHaveAttribute('data-project-id', originalId); await waitForProjectActivation(editor);
	const copyId = await editor.getAttribute('data-project-id');
	const copyTitle = await editor.locator('[data-project-name]').innerText();
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Consolidate media']);
	await expect.poll(() => boundProjects(page)).not.toContain(copyId);
	await editor.getByRole('tab', { name: title, exact: true }).click();
	await expect(editor).toHaveAttribute('data-project-id', originalId); await waitForProjectActivation(editor);
	await page.evaluate(choice => { globalThis.__projectBinLinkedAudioFixture.next = choice === 'changed' ? 'accepted' : 'exact'; }, choice);
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
	if (choice === 'changed') {
		const dialog = page.locator('[data-project-bin-relink-changed-dialog]'); await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Replace', exact: true }).click(); await expect(dialog).toBeHidden();
		await expect.poll(async () => (await boundProjects(page, '4'.repeat(64))).includes(originalId)
			|| await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.released.length > 0)).toBe(true);
		await expect(editor).toContainText(/managed audio.*Import.*new media/iu);
		expect(await boundProjects(page, '1'.repeat(64))).toContain(originalId);
	} else await expect.poll(() => boundProjects(page, '2'.repeat(64))).toContain(originalId);
	await expect(card).toHaveAttribute('data-unavailable', 'false');
	await card.getByRole('button', { name: /Add to timeline/u }).click(); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expectOriginalTone(page, editor);
	await editor.getByRole('tab', { name: copyTitle, exact: true }).click();
	await expect(editor).toHaveAttribute('data-project-id', copyId); await waitForProjectActivation(editor);
	await card.getByRole('button', { name: /Add to timeline/u }).click(); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expectOriginalTone(page, editor);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload(); await waitForEditor(page); await waitForProjectActivation(editor);
	await expectOriginalTone(page, editor);
});

async function boundProjects(page, locatorId = null) {
	return page.evaluate(({ databaseName, locatorId }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName); opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const db = opening.result, request = db.transaction('linkedVideoOriginalBindings', 'readonly').objectStore('linkedVideoOriginalBindings').getAll();
			request.onerror = () => { db.close(); reject(request.error); };
			request.onsuccess = () => { db.close(); resolve(request.result.filter(record => !locatorId || record.binding.locatorId === locatorId).map(record => record.binding.projectId)); };
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, locatorId });
}

async function expectOriginalTone(page, editor) {
	const count = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const exportDialog = await openExportDialog(page, editor);
	await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
	await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(count + 1);
	await closeDialog(exportDialog);
	const frequency = await page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports.at(-1), context = new AudioContext();
		try {
			const buffer = await context.decodeAudioData(bytes.buffer.slice(0)), pcm = buffer.getChannelData(0);
			const start = Math.floor(pcm.length / 4), end = Math.floor(pcm.length * 3 / 4); let crossings = 0;
			for (let frame = start + 1; frame < end; frame++) if (pcm[frame - 1] < 0 && pcm[frame] >= 0) crossings++;
			return crossings * buffer.sampleRate / (end - start);
		} finally { await context.close(); }
	});
	expect(Math.abs(frequency - 330)).toBeLessThan(8);
}
