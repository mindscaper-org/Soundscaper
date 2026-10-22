/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { unzipSync, strFromU8 } from 'fflate';

test('clicking a quiet Master thumb without changing it preserves its gain', async ({ page }) => {
	const gain = .0008;
	await disableNativeSavePicker(page);
	const project = createSoundscaperProject({ id: `idle-master-${gain}`, tracks: [createAudioTrack({ id: 'empty', name: 'Empty' })], master: { gain, effects: [] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false }); let blob;
	try { blob = (await exportScapeProject(project, store)).blob; } finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Precise master.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const effects = await openEffectsForTrack(editor, 0);
	const range = effects.getByRole('slider', { name: 'Master gain', exact: true });
	await range.evaluate(input => { input.dataset.changes = '0'; input.addEventListener('input', () => { input.dataset.changes = String(Number(input.dataset.changes) + 1); }); });
	const box = await range.boundingBox(); expect(box).not.toBeNull();
	const fraction = (Number(await range.inputValue()) + 60) / 72;
	await page.mouse.click(box.x + 8 + fraction * (box.width - 16), box.y + box.height / 2);
	await expect(range).toHaveAttribute('data-changes', '0');
	const downloaded = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await downloaded));
	const saved = JSON.parse(strFromU8(files['project.json']));
	expect(saved.master.gain).toBe(gain);
});
