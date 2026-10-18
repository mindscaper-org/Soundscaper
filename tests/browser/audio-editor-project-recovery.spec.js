import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test.describe('damaged local project recovery', () => {
	registerAudioEditorHooks();

	test('startup offers a repaired copy while preserving the damaged original and valid audio', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const originalId = await editor.getAttribute('data-project-id');
		await damageProject(page, originalId);
		await page.reload();
		const recovery = page.getByRole('dialog', { name: 'Project recovery', exact: true });
		await expect(recovery).toBeVisible();
		await expect(recovery.getByRole('heading', { name: 'Proposed repairs' })).toBeVisible();
		await expect(recovery.getByLabel('Saved version')).toContainText('Needs repair');
		await recovery.getByRole('button', { name: 'Recover as a new project' }).click();
		await expect(recovery).not.toBeVisible();
		const reopened = page.locator('[data-audio-editor]').first();
		await expect(reopened).toHaveAttribute('data-clip-count', '1');
		await expect(reopened).not.toHaveAttribute('data-project-id', originalId);
		await expect(reopened.locator('[data-project-name]')).toContainText('recovered');
		await expect(reopened.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const original = await readProject(page, originalId);
		expect(original.clips).toHaveLength(2);
		expect(original.clips[0].sourceStartFrame).toBe(-1);
		await chooseNestedCommandAction(page, reopened, 'File', ['Project management', 'Recover a project']);
		await expect(recovery).toBeVisible();
		await recovery.getByLabel('Saved version').selectOption({ label: await recovery.getByLabel('Saved version').locator('option').filter({ hasText: 'Ready to recover' }).first().textContent() });
		await recovery.getByRole('button', { name: 'Recover as a new project' }).click();
		await expect(reopened).toHaveAttribute('data-clip-count', '2');
	});
});

async function damageProject(page, projectId) {
	return page.evaluate(async ({ databaseName, projectId }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			await new Promise((resolve, reject) => {
				const transaction = database.transaction(['projects', 'revisions'], 'readwrite');
				const projects = transaction.objectStore('projects');
				const request = projects.get(projectId);
				request.onsuccess = () => {
					const project = request.result;
					project.clips[0].sourceStartFrame = -1;
					project.revision += 100;
					projects.put(project);
					transaction.objectStore('revisions').put({ key: `${projectId}:${project.revision}`, projectId, revision: project.revision, project });
				};
				transaction.oncomplete = resolve;
				transaction.onabort = () => reject(transaction.error);
			});
		} finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId });
}

async function readProject(page, projectId) {
	return page.evaluate(async ({ databaseName, projectId }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const request = database.transaction('projects', 'readonly').objectStore('projects').get(projectId);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		} finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId });
}
