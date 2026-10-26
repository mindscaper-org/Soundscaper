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
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('File Open retains the decoded video source for its authored alpha mask', async ({ page }) => {
	const file = videoPreviewBenchmarkMedia.file;
	const source = createVideoSource({ id: 'camera', storageKey: randomUUID(), name: 'Camera', mimeType: 'video/webm',
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const mask = { schemaVersion: 1, id: 'video-mask', kind: 'mask',
		inputs: [{ name: 'Plate', sourceRef: source.id, kind: 'alpha' }],
		nodes: [{ id: 'coverage', kind: 'alpha', inputName: 'Plate' }], outputNodeId: 'coverage' };
	const project = createFramescaperProject(PROFILE, { id: 'video-alpha-mask', sources: [source],
		clips: [{ kind: 'video', id: 'picture', title: 'Picture', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['picture'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main',
		visualModel: { maskMattes: [mask] }, finishing: { visualPresentations: [{ schemaVersion: 1,
			id: 'masked-picture', owner: { kind: 'clip', id: 'picture' }, enabled: true, opacity: 1,
			blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: [mask.id] }] } });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	let archive;
	try {
		await store.writeMediaAsset(source.storageKey, new Blob([file.buffer], { type: 'video/webm' }),
			{ name: file.name, mimeType: 'video/webm' });
		archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'The authored mask needs the maintained WebGL2 exact preview.');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Video alpha mask.fscape', mimeType: 'application/zip',
		buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(preview).toHaveAttribute('data-active-clip-id', 'picture');
});
