/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseFileAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { showClipTimingFields } from './audio-editor-inspector-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('native generator Properties retains the exact retimed source EOF', async ({ page }) => {
	const project = createFramescaperProject(PROFILE, { id: 'generator-eof',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Tail',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
			generator: { kind: 'solid', color: '#ffffffff' } }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'tail', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 23, sourceInFrame: 123, sourceFrameCount: 27 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['tail'] }],
		sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Retimed title.scape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const clip = editor.getByRole('group', { name: 'Video clip: Tail', exact: true }); await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip properties']);
	const panel = editor.locator('[data-workspace-panel="clip-properties"]'); await showClipTimingFields(panel);
	const duration = panel.getByRole('group', { name: 'Duration', exact: true });
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000000920']);
	await duration.locator('.timecode-digit').nth(5).click(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000000920']);
});
