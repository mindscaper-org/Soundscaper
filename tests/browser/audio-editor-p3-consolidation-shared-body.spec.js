/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const shared of [true, false]) test(`Consolidate media handles identical originals shared by project copies; shared=${shared}`, async ({ page }) => {
	test.setTimeout(90_000);
	await installLinkedAudioBridge(page, {
		original: createWavFixture({ name: 'Original.wav', frequency: 330, duration: 1, channelCount: 1 }),
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	await expect(editor.locator('[data-project-bin-item]').first()).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const originalId = await editor.getAttribute('data-project-id');
	const title = await editor.locator('[data-project-name]').innerText();
	if (shared) {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
		await expect(editor).not.toHaveAttribute('data-project-id', originalId); await waitForProjectActivation(editor);
		const copyId = await editor.getAttribute('data-project-id');
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Consolidate media']);
		await expect.poll(() => linkedProjects(page)).not.toContain(copyId);
		await editor.getByRole('tab', { name: title, exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', originalId); await waitForProjectActivation(editor);
		await expect.poll(() => linkedProjects(page)).toContain(originalId);
	}
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Consolidate media']);
	await expect.poll(() => linkedProjects(page)).not.toContain(originalId);
	await expect(editor).toContainText('Media consolidated');
	await page.reload();
	await waitForEditor(page); await waitForProjectActivation(editor);
	await expect(editor.locator('[data-project-bin-item]').first()).toHaveAttribute('data-unavailable', 'false');
});

async function linkedProjects(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName); opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const db = opening.result, request = db.transaction('linkedVideoOriginalBindings', 'readonly').objectStore('linkedVideoOriginalBindings').getAll();
			request.onerror = () => { db.close(); reject(request.error); };
			request.onsuccess = () => { db.close(); resolve(request.result.map(record => record.binding.projectId)); };
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}
