/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseDropdown, closeDialog, openExportDialog, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { clearSourceProvenance, installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const choice of ['exact', 'accepted']) test(`relinking a copied linked source preserves every project alias; choice=${choice}`, async ({ page }) => {
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
	const originalTitle = await editor.locator('[data-project-name]').innerText(); await clearSourceProvenance(page, originalId);
	await page.reload(); await waitForEditor(page); await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
	await expect(editor).not.toHaveAttribute('data-project-id', originalId); await waitForProjectActivation(editor);
	const copyId = await editor.getAttribute('data-project-id');
	const before = await bindings(page); expect(before).toHaveLength(2);
	await page.evaluate(next => { globalThis.__projectBinLinkedAudioFixture.next = next; }, choice);
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
	if (choice === 'accepted') {
		const dialog = page.locator('[data-project-bin-relink-changed-dialog]'); await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Replace', exact: true }).click(); await expect(dialog).toBeHidden();
	}
	await expect.poll(async () => {
		const current = await bindings(page);
		return JSON.stringify(current) !== JSON.stringify(before) || await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.released.length > 0);
	}).toBe(true);
	const after = await bindings(page);
	if (choice === 'accepted') {
		expect(after).toEqual(before);
		await expect(editor).toContainText(/shared.*Import.*new media/iu);
	} else {
		expect(after.every(binding => binding.locatorId === '2'.repeat(64))).toBe(true);
		expect(after.find(binding => binding.projectId === copyId).bindingToken).not.toBe(before.find(binding => binding.projectId === copyId).bindingToken);
	}
	await expect(card).toHaveAttribute('data-unavailable', 'false');
	await card.getByRole('button', { name: /Add to timeline/u }).click(); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expectOriginalTone(page, editor);
	await editor.getByRole('tab', { name: originalTitle, exact: true }).click();
	await expect(editor).toHaveAttribute('data-project-id', originalId); await waitForProjectActivation(editor);
	await expect(card).toHaveAttribute('data-unavailable', 'false');
	await card.getByRole('button', { name: /Add to timeline/u }).click(); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expectOriginalTone(page, editor);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload(); await waitForEditor(page); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-project-id', originalId);
	await expect(card).toHaveAttribute('data-unavailable', 'false');
	await expectOriginalTone(page, editor);
});

async function bindings(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const db = opening.result;
			const request = db.transaction('linkedVideoOriginalBindings', 'readonly').objectStore('linkedVideoOriginalBindings').getAll();
			request.onerror = () => { db.close(); reject(request.error); };
			request.onsuccess = () => { db.close(); resolve(request.result.map(record => record.binding).sort((a, b) => a.projectId.localeCompare(b.projectId))); };
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

async function expectOriginalTone(page, editor) {
	const count = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(count + 1);
	await closeDialog(dialog);
	const frequency = await page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports.at(-1);
		const context = new AudioContext();
		try {
			const buffer = await context.decodeAudioData(bytes.buffer.slice(0)), pcm = buffer.getChannelData(0);
			const start = Math.floor(pcm.length / 4), end = Math.floor(pcm.length * 3 / 4); let crossings = 0;
			for (let frame = start + 1; frame < end; frame++) if (pcm[frame - 1] < 0 && pcm[frame] >= 0) crossings++;
			return crossings * buffer.sampleRate / (end - start);
		} finally { await context.close(); }
	});
	expect(Math.abs(frequency - 330)).toBeLessThan(8);
}
