/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';

for (const [reference, target] of [[' Voice ', 'spaced'], ['Voice', 'plain']]) test(`spreadsheet paste preserves track name ${JSON.stringify(reference)}`, async ({ page, browserName, context }) => {
	if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let blob;
	try {
		const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'spreadsheet-track-name', sources: [source], tracks: [
			createAudioTrack({ id: 'origin', name: 'Origin', clipIds: ['template'] }), createAudioTrack({ id: 'plain', name: 'Voice' }), createAudioTrack({ id: 'spaced', name: ' Voice ' }),
		], clips: [createAudioClip({ id: 'template', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })] });
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
		blob = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Tracks.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'spreadsheet-track-name'); await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid'); await expect(grid).toBeFocused();
	const sourceId = await grid.locator('[data-row="0"][data-column="source"]').textContent();
	const tsv = ['Pasted', reference, '0', sourceId].join('\t');
	if (browserName === 'chromium') { await page.evaluate(text => navigator.clipboard.writeText(text), tsv); await page.keyboard.press('ControlOrMeta+v'); }
	else await grid.evaluate((element, text) => { const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }); event.clipboardData.setData('text/plain', text); element.dispatchEvent(event); }, tsv);
	const cell = grid.locator('[data-row="1"][data-column="track"]'); await expect(cell).toHaveText(target);
	await expect(editor.locator(`[data-track-row][data-track-id="${target}"] [data-clip-id]`)).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(cell).toHaveText(target);
});
