/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';

test('ordinary opacity edits preserve an imported compound mask', async ({ page }) => {
	const editor = await openMaskedProject(page);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector']]);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await dialog.getByRole('spinbutton', { name: 'Opacity', exact: true }).fill('0.5');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual updated.');
	await expect.poll(async () => (await savedProject(page))?.videoVisualPresentations[0]?.opacity).toBe(0.5);
	expect((await savedProject(page)).videoMaskMattes).toEqual([compoundMask]);
});

test('the simple mask editor preserves complex graphs while allowing fresh attachments and Undo', async ({ page }) => {
	const editor = await openMaskedProject(page);
	await chooseNestedCommandAction(page, editor, 'Effect', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.editVideoMaskMatte']]);
	const dialog = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
	await expect(dialog.getByRole('button', { name: 'Update attached mask', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('combobox', { name: 'Shape', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('spinbutton', { name: 'Width', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Remove attachment', exact: true })).toBeEnabled();
	await dialog.getByRole('combobox', { name: 'Attached mask', exact: true }).selectOption('');
	await expect(dialog.getByRole('spinbutton', { name: 'Width', exact: true })).toBeEnabled();
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('0.4');
	await dialog.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await expect.poll(async () => (await savedProject(page))?.videoMaskMattes.length).toBe(2);
	expect((await savedProject(page)).videoMaskMattes.find(mask => mask.id === 'compound')).toEqual(compoundMask);
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await savedProject(page))?.videoMaskMattes).toEqual([compoundMask]);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await savedProject(page))?.videoMaskMattes.length).toBe(2);
});

const compoundMask = { schemaVersion: 1, id: 'compound', kind: 'mask', inputs: [],
	nodes: [{ id: 'inverse', kind: 'invert', inputNodeId: 'shape' },
		{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0.1, y: 0.1, width: 0.6, height: 0.6 }], outputNodeId: 'inverse' };

async function openMaskedProject(page) {
	const project = createFramescaperProject(PROFILE, { id: 'compound-mask',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Masked title',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
			generator: { kind: 'solid', color: '#ffffffff' } }], maskMattes: [compoundMask] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'masked', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['masked'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main',
		finishing: { visualPresentations: [{ schemaVersion: 1, id: 'view', owner: { kind: 'clip', id: 'masked' }, enabled: true,
			opacity: 1, blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: ['compound'] }] },
	});
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Compound.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'compound-mask'); await waitForProjectActivation(editor);
	await editor.getByRole('group', { name: 'Video clip: Masked title', exact: true }).press('Enter');
	return editor;
}

async function savedProject(page) {
	return page.evaluate(async name => {
		const read = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		const database = await read(indexedDB.open(name));
		try { return await read(database.transaction('projects', 'readonly').objectStore('projects').get('compound-mask')); }
		finally { database.close(); }
	}, FRAMESCAPER_DATABASE_NAME);
}
