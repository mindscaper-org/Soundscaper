/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

for (const clipId of ['picture', 'Picture 映像', 'clip "one"']) test(`File Open renders the native picture ${clipId}`, async ({ page }) => {
	const file = videoPreviewBenchmarkMedia.file;
	const source = createVideoSource({ id: 'camera', storageKey: randomUUID(), name: 'Camera', mimeType: 'video/webm',
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: 'clip-identity', sources: [source],
		clips: [{ kind: 'video', id: clipId, title: 'Picture', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 30, sourceFrameCount: 30, retimeMap: null }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: [clipId] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	let archive;
	try {
		await store.writeMediaAsset(source.storageKey, new Blob([file.buffer], { type: 'video/webm' }), { name: file.name, mimeType: 'video/webm' });
		archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const renderer = await page.evaluate(hasWebGl2Capability) ? 'ready' : 'fallback';
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Picture.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', renderer, { timeout: 30_000 });
	await seekFramescaperTimecode(page, editor, '00:00:00:01');
	await expect(preview).toHaveAttribute('data-active-clip-id', clipId);
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
});
