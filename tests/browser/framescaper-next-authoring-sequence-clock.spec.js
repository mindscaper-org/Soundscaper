/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('a side sequence owns the duration clock of its selected dissolve', async ({ page }) => {
	const archive = await twoClockProjectFile();
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'Two clocks.scape', mimeType: 'application/zip', buffer: archive });
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await editor.getByRole('group', { name: 'Video clip: first', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Transitions', 'Add Dissolve Transition']);
	const dialog = page.getByRole('dialog', { name: 'Dissolve Transition', exact: true });
	const timecode = dialog.locator('[data-framescaper-authoring-duration]');
	await timecode.locator('.timecode__display').dblclick();
	await timecode.getByRole('textbox').fill('1s'); await timecode.getByRole('textbox').press('Enter');
	await expect(timecode.locator('[data-timecode-direct-entry]')).toHaveValue('25');
	await dialog.getByRole('button', { name: 'Apply dissolve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
});

async function twoClockProjectFile() {
	const file = videoPreviewBenchmarkMedia.file;
	const source = createVideoSource({ id: 'camera', storageKey: 'camera', name: 'Camera', mimeType: 'video/webm',
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: 'two-clock-file', sources: [source],
		clips: ['first', 'second'].map((id, index) => ({ kind: 'video', id, sourceId: source.id, title: id,
			sequenceId: 'cut', sequenceStartFrame: index * 75, sequenceFrameCount: 75,
			sourceInFrame: index * 90, sourceFrameCount: 90, retimeMap: null })),
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['first', 'second'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'cut', rate: { num: 25, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	await store.writeMediaAsset(source.storageKey, new Blob([file.buffer], { type: 'video/webm' }), {
		name: file.name, mimeType: 'video/webm',
	});
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	if (!(archive.blob instanceof Blob)) throw new Error('The native fixture archive was not produced.');
	return Buffer.from(await archive.blob.arrayBuffer());
}
