/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('a native dissolve changes the chosen colon-containing pair and preserves the other track', async ({ page }) => {
	const archive = await pairProjectFile();
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'Two pairs.scape', mimeType: 'application/zip', buffer: archive });
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	const first = editor.getByRole('group', { name: 'Video clip: First in', exact: true });
	const second = editor.getByRole('group', { name: 'Video clip: Second in', exact: true });
	const firstBefore = await first.boundingBox(), secondBefore = await second.boundingBox();
	expect(firstBefore).not.toBeNull(); expect(secondBefore).not.toBeNull();
	await editor.getByRole('group', { name: 'Video clip: Second out', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Transitions', 'Add Dissolve Transition']);
	const dialog = page.getByRole('dialog', { name: 'Dissolve Transition', exact: true });
	await dialog.locator('[data-framescaper-authoring-pair]').selectOption({ label: 'Second out → Second in' });
	await dialog.getByRole('button', { name: 'Apply dissolve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect.poll(async () => (await second.boundingBox())?.x).toBeLessThan(secondBefore.x);
	expect((await first.boundingBox())?.x).toBe(firstBefore.x);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await second.boundingBox())?.x).toBe(secondBefore.x);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await second.boundingBox())?.x).toBeLessThan(secondBefore.x);
	expect((await first.boundingBox())?.x).toBe(firstBefore.x);
});

async function pairProjectFile() {
	const file = videoPreviewBenchmarkMedia.file, sourceId = randomUUID();
	const source = createVideoSource({ id: sourceId, storageKey: sourceId, name: 'Camera', mimeType: 'video/webm',
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const rows = [['t', 'a:b', 'c:d'], ['t:a', 'b:c', 'd']];
	const project = createFramescaperProject(PROFILE, { id: 'pair-identity-file', sources: [source],
		clips: rows.flatMap(([, outgoing, incoming], row) => [outgoing, incoming].map((id, index) => ({
			kind: 'video', id, title: `${row === 0 ? 'First' : 'Second'} ${index === 0 ? 'out' : 'in'}`,
			sourceId, sequenceId: 'main', sequenceStartFrame: index * 30, sequenceFrameCount: 30,
			sourceInFrame: index * 30, sourceFrameCount: 30, retimeMap: null }))),
		tracks: rows.map(([id, outgoing, incoming]) => ({ id, type: 'video', clipIds: [outgoing, incoming] })),
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: rows.map(([id]) => id) }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	await store.writeMediaAsset(source.storageKey, new Blob([file.buffer], { type: 'video/webm' }), { name: file.name, mimeType: 'video/webm' });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	if (!(archive.blob instanceof Blob)) throw new Error('The native pair archive was not produced.');
	return Buffer.from(await archive.blob.arrayBuffer());
}
