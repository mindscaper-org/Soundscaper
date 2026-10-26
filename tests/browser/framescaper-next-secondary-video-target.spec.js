/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('a secondary video Target governs the actual Project Bin edit destination', async ({ page }) => {
	const archive = await projectFile();
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Secondary.scape', mimeType: 'application/zip', buffer: archive });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await editor.getByRole('group', { name: 'Video clip: Placed', exact: true }).press('Enter');
	const openTarget = async () => {
		await editor.locator('[data-video-track]').getByRole('button', { name: 'Track options', exact: true }).click();
		return page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: 'Target', exact: true });
	};
	const target = await openTarget();
	await expect(target.locator('.context-menu-item-checkmark > *')).toHaveCount(1);
	await target.click();
	const untargeted = await openTarget();
	await expect(untargeted.locator('.context-menu-item-checkmark > *')).toHaveCount(0);
	await untargeted.click();
	await expect(editor.locator('[data-bin-action="overwrite"]')).toBeEnabled();
	await editor.locator('[data-bin-action="overwrite"]').click();
	await expect(editor.locator('[data-clip-id="placed"]')).toHaveCount(0);
	await expect.poll(async () => {
		const project = await savedProject(page);
		return project?.clips.map(({ sequenceId, sequenceFrameCount, sourceFrameCount }) => ({ sequenceId, sequenceFrameCount, sourceFrameCount }));
	}).toEqual([{ sequenceId: 'cut', sequenceFrameCount: 150, sourceFrameCount: 180 }]);
});

async function projectFile() {
	const file = videoPreviewBenchmarkMedia.file, sourceId = `camera-${randomUUID()}`;
	const source = createVideoSource({ id: sourceId, storageKey: sourceId, name: 'Camera', mimeType: 'video/webm',
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleRate: 48_000, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const clip = { kind: 'video', id: 'placed', sourceId, title: 'Placed', sequenceId: 'cut', sequenceStartFrame: 0,
		sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 180, retimeMap: null };
	const project = createFramescaperProject(PROFILE, { id: 'secondary-target', sources: [source], clips: [clip],
		projectBin: { clips: [{ ...clip, id: 'bin', binItemId: 'item' }] },
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['placed'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'cut', rate: { num: 25, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	await store.writeMediaAsset(sourceId, new Blob([file.buffer], { type: 'video/webm' }), { name: file.name, mimeType: 'video/webm' });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	return Buffer.from(await archive.blob.arrayBuffer());
}

async function savedProject(page) {
	return page.evaluate(async name => {
		const request = operation => new Promise((resolve, reject) => {
			operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error);
		});
		const database = await request(indexedDB.open(name));
		try {
			return await request(database.transaction('projects', 'readonly').objectStore('projects').get('secondary-target'));
		} finally { database.close(); }
	}, FRAMESCAPER_DATABASE_NAME);
}
