/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('Bin insertion keeps a five-second visual when its destination has a different frame rate', async ({ page }) => {
	const project = createFramescaperProject(PROFILE, { id: 'visual-bin-cross-rate', visualModel: { generatorSources: [{
		schemaVersion: 1, kind: 'generator', id: 'title-source', name: 'Title', width: 1920, height: 1080,
		frameRate: { num: 60, den: 1 }, frameCount: 300, generator: { kind: 'solid', color: '#ffffffff' },
	}] }, clips: [{ schemaVersion: 1, kind: 'generator', id: 'title', sourceId: 'title-source', sequenceId: 'cut',
		sequenceStartFrame: 0, sequenceFrameCount: 300, sourceInFrame: 0, sourceFrameCount: 300 }],
	tracks: [{ id: 'pictures', type: 'video', clipIds: ['title'] }],
	sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: [] },
		{ id: 'cut', rate: { num: 60, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	let archive;
	try { archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store); }
	finally { await store.close(); }
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Visual.scape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await clip.press('Enter');
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card.locator('.kw-audio-editor__project-bin-meta')).toContainText('0:05.0');
	await card.getByRole('button', { name: 'Add to timeline: Title', exact: true }).click();
	await expect(clip).toBeVisible();
	const expected = [{ sequenceId: 'main', duration: 125, sourceStart: 0, sourceDuration: 300 }];
	await expect.poll(() => savedGeometry(page, project.id)).toEqual(expected);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toHaveCount(0);
	await expect(card).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clip).toBeVisible();
	await expect.poll(() => savedGeometry(page, project.id)).toEqual(expected);
});

async function savedGeometry(page, id) {
	return page.evaluate(async ({ name, id }) => {
		const request = operation => new Promise((resolve, reject) => {
			operation.onsuccess = () => resolve(operation.result);
			operation.onerror = () => reject(operation.error);
		});
		const database = await request(indexedDB.open(name));
		try {
			const project = await request(database.transaction('projects', 'readonly').objectStore('projects').get(id));
			return project?.clips.map(clip => ({ sequenceId: clip.sequenceId, duration: clip.sequenceFrameCount,
				sourceStart: clip.sourceInFrame, sourceDuration: clip.sourceFrameCount }));
		} finally { database.close(); }
	}, { name: FRAMESCAPER_DATABASE_NAME, id });
}
