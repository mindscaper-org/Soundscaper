/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('a secondary sixty-fps title keeps its duration when moved to Project Bin', async ({ page }) => {
	const project = createFramescaperProject(PROFILE, { id: 'visual-bin-clock', visualModel: { generatorSources: [{
		schemaVersion: 1, kind: 'generator', id: 'title-source', name: 'Title', width: 1920, height: 1080,
		frameRate: { num: 60, den: 1 }, frameCount: 300, generator: { kind: 'solid', color: '#ffffffff' },
	}] }, clips: [{ schemaVersion: 1, kind: 'generator', id: 'title', sourceId: 'title-source', sequenceId: 'cut',
		sequenceStartFrame: 0, sequenceFrameCount: 300, sourceInFrame: 0, sourceFrameCount: 300 }],
	tracks: [{ id: 'pictures', type: 'video', clipIds: ['title'] }],
	sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: [] },
		{ id: 'cut', rate: { num: 60, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Visual.scape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await clip.press('Enter'); await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card.locator('.kw-audio-editor__project-bin-meta')).toContainText('0:05.0');
});
