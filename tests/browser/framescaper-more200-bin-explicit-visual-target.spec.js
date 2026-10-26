/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('Bin Add visual honors the explicitly focused secondary picture track', async ({ page }) => {
	const project = createFramescaperProject(PROFILE, { id: 'explicit-bin-picture-target',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
			generator: { kind: 'solid', color: '#ffffffff' } }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'solid', sourceId: 'solid-source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 }],
		tracks: [{ id: 'main-pictures', name: 'Main pictures', type: 'video', clipIds: ['solid'] },
			{ id: 'cut-pictures', name: 'Secondary pictures', type: 'video', clipIds: [] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['main-pictures'] },
			{ id: 'cut', rate: { num: 25, den: 1 }, trackIds: ['cut-pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	let archive;
	try { archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store); }
	finally { await store.close(); }
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Pictures.fscape', mimeType: 'application/zip',
		buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await clip.press('Enter'); await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	await expect(clip).toHaveCount(0);
	const secondary = editor.locator('[data-track-row][data-track-id="cut-pictures"]');
	await secondary.locator('[data-track-name]').click();
	await expect(secondary.locator('[data-track-header]')).toHaveAttribute('data-selected', 'true');
	const card = editor.locator('[data-project-bin-item]').first();
	await card.getByRole('button', { name: 'Add to timeline: Solid', exact: true }).click();
	await expect(secondary.getByRole('group', { name: 'Video clip: Solid', exact: true })).toBeVisible();
	await expect(editor.locator('[data-track-row][data-track-id="main-pictures"]').getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(clip).toHaveCount(0);
	await expect(card).toBeVisible(); await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(secondary.getByRole('group', { name: 'Video clip: Solid', exact: true })).toBeVisible();
});
