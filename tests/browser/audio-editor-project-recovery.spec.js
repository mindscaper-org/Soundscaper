import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { createHash } from 'node:crypto';
import { makeStoredZip } from '../helpers/stored-zip.js';
import { bootEditor, chooseFileAction, chooseExportProjectFileAction, chooseNestedCommandAction,
	commitInput, disableNativeSavePicker, downloadBytes, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test.describe('damaged local project recovery', () => {
	registerAudioEditorHooks();

	test('Open Recent offers recovery repeatedly while preserving the current workspace and damaged original', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
		await commitInput(rename.locator('[data-project-name-input] input'), 'Damaged saved project');
		await rename.getByRole('button', { name: 'Save name', exact: true }).click();
		await importFiles(editor, [toneA, toneB]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const damagedId = await editor.getAttribute('data-project-id');
		await chooseFileAction(page, editor, 'New');
		await expect(editor).not.toHaveAttribute('data-project-id', damagedId);
		const currentId = await editor.getAttribute('data-project-id');
		await editor.getByRole('button', { name: 'Close project: Damaged saved project', exact: true }).click();
		await damageProject(page, damagedId);
		const recovery = page.getByRole('dialog', { name: 'Project recovery', exact: true });
		for (const attempt of [0, 1]) {
			await chooseNestedCommandAction(page, editor, 'File', ['Open recent', 'Damaged saved project']);
			await expect(recovery).toBeVisible();
			await expect(recovery.getByRole('heading', { name: 'Proposed repairs' })).toBeVisible();
			await expect(editor).toHaveAttribute('data-project-id', currentId);
			if (attempt === 0) {
				await page.keyboard.press('Escape');
				await expect(recovery).toBeHidden();
			}
		}
		await recovery.getByRole('button', { name: 'Recover as a new project' }).click();
		await expect(recovery).toBeHidden();
		await expect(editor).not.toHaveAttribute('data-project-id', damagedId);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		expect((await readProject(page, damagedId)).clips[0].sourceStartFrame).toBe(-1);
	});

	for (const damage of ['document', 'missing audio', 'corrupt audio']) {
		test(`File Open offers a separate recovered archive after ${damage} damage`, async ({ page }) => {
			await disableNativeSavePicker(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [toneA, toneB]);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			const originalId = await editor.getAttribute('data-project-id');
			const downloading = page.waitForEvent('download');
			await chooseExportProjectFileAction(page, editor);
			const bytes = await damagedArchive(await downloadBytes(await downloading), damage);
			const open = async () => {
				const chooser = page.waitForEvent('filechooser');
				await chooseFileAction(page, editor, 'Open');
				await (await chooser).setFiles({ name: 'damaged.scape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: bytes });
				if (damage === 'corrupt audio') {
					await page.getByRole('dialog', { name: 'Project already exists', exact: true })
						.getByRole('button', { name: 'Open as copy', exact: true }).click();
				}
			};
			await open();
			const recovery = page.getByRole('dialog', { name: 'Project recovery', exact: true });
			await expect(recovery).toBeVisible();
			await expect(recovery.getByRole('heading', { name: 'Proposed repairs' })).toBeVisible();
			await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(editor).toHaveAttribute('data-project-id', originalId);
			await open();
			await recovery.getByRole('button', { name: 'Recover as a new project' }).click();
			await expect(recovery).toBeHidden();
			await expect(editor).not.toHaveAttribute('data-project-id', originalId);
			await expect(editor).toHaveAttribute('data-clip-count', damage === 'document' ? '2' : '1');
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			expect((await readProject(page, originalId)).clips).toHaveLength(2);
		});
	}

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

async function damagedArchive(bytes, damage) {
	const reader = new ZipReader(new BlobReader(new Blob([bytes])), { useWebWorkers: false });
	const files = new Map();
	try {
		for (const entry of await reader.getEntries()) files.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
	} finally { await reader.close(); }
	const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
	if (damage === 'document') {
		const project = JSON.parse(new TextDecoder().decode(files.get('project.json')));
		project.tracks[0].gain = -999;
		const body = new TextEncoder().encode(JSON.stringify(project));
		files.set('project.json', body);
		manifest.project.size = body.byteLength;
		manifest.project.sha256 = createHash('sha256').update(body).digest('hex');
		files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	} else {
		const asset = manifest.assets.filter(({ kind }) => kind === 'audio')[1];
		if (damage === 'missing audio') files.delete(asset.entry);
		else { const body = files.get(asset.entry); body[body.length - 1] ^= 0x20; }
	}
	return makeStoredZip([...files].map(([name, data]) => ({ name, data })));
}

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
