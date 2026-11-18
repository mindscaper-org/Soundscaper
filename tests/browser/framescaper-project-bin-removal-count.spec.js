/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

function persistedProject(page, projectId) {
	return page.evaluate(({ databaseName, projectId }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const request = database.transaction('projects', 'readonly').objectStore('projects').get(projectId);
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => { database.close(); resolve(request.result); };
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, projectId });
}

test('removing standalone bin audio discloses its linked timeline picture too', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicAvFixture('Interview.webm'));
	const original = editor.locator('[data-project-bin-item][data-project-bin-media-kind="video"]');
	const add = original.getByRole('button', { name: /^Add to timeline:/u });
	await add.click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('End');
	await add.click();
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	const videos = editor.getByRole('group', { name: /^Video clip: Interview/u });
	const projectId = await editor.getAttribute('data-project-id');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, projectId);
	const videoId = await videos.last().getAttribute('data-clip-id');
	const video = project.clips.find(clip => clip.id === videoId);
	const audio = project.clips.find(clip => clip.kind === 'audio' && clip.avLinkId === video.avLinkId);
	const audioHeader = editor.locator(`[data-clip-id="${audio.id}"] .clip-header`);
	await videos.last().press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
	await expect.poll(async () => (await persistedProject(page, projectId)).clips.find(clip => clip.id === audio.id)?.avLinkId ?? null).toBeNull();
	await audioHeader.click();
	await audioHeader.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	const standalone = editor.locator('[data-project-bin-item][data-project-bin-media-kind="audio"]');
	await standalone.getByRole('button', { name: /^More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	const dialog = page.getByRole('alertdialog', { name: 'Remove from project', exact: true });
	const confirmation = await dialog.locator('p').textContent();
	await dialog.getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(videos).toHaveCount(1);
	expect(confirmation).toContain('all 2 instances');
});
