/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('native source identities do not invent an EDL reel override', async ({ page }) => {
	const archive = await projectFile();
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'Source identity.scape', mimeType: 'application/zip', buffer: archive });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export edit list (EDL)']);
	const text = new TextDecoder().decode(await downloadBytes(await downloading));
	const row = text.split('\n').find(line => /^001\s/u.test(line));
	expect(row?.trim().split(/\s+/u)[1]).toBe('CAMERA');
	expect(text).toContain('* FROM CLIP NAME: Picture');
});

async function projectFile() {
	const file = videoPreviewBenchmarkMedia.file, sourceId = 'toString', storageKey = randomUUID();
	const source = createVideoSource({ id: sourceId, storageKey, name: 'CAMERA', mimeType: 'video/webm',
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: 'source-identity-file', sources: [source],
		clips: [{ kind: 'video', id: 'picture', title: 'Picture', sourceId, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null }],
		tracks: [{ id: 'camera-track', type: 'video', clipIds: ['picture'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['camera-track'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	await store.writeMediaAsset(storageKey, new Blob([file.buffer], { type: 'video/webm' }), { name: file.name, mimeType: 'video/webm' });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	if (!(archive.blob instanceof Blob)) throw new Error('The native source archive was not produced.');
	return Buffer.from(await archive.blob.arrayBuffer());
}
