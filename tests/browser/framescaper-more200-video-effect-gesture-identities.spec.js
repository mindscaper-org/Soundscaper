/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, openClipProperties, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createVideoEffect } from '../../src/common/editor/video-effects.js';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../../src/common/editor/video-clip-composition.ts';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('File Open effect previews do not alter an occluding clip with a colon-bearing identity', async ({ page }) => {
	const file = createDeterministicSilentVideoFixture('Camera.webm'), storageKey = randomUUID();
	const source = createVideoSource({ id: 'camera', name: 'Camera', storageKey, mimeType: file.mimeType,
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), sourceFrameCount: 32,
		sampleFrameCount: 102_400, frameRate: { num: 15, den: 1 }, width: 96, height: 54 });
	const project = createFramescaperProject(PROFILE, { id: 'effect-gesture-identities', sources: [source],
		clips: ['a:b', 'a'].map((id, index) => ({ kind: 'video', id, sourceId: source.id,
			title: index === 0 ? 'Underlying picture' : 'Occluding picture', sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
			videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, compositingOrder: index },
			videoEffects: [createVideoEffect('color-adjust', { id: index === 0 ? 'c' : 'b:c' })] })),
		tracks: ['a:b', 'a'].map((id, index) => ({ id: `pictures-${index}`, type: 'video', clipIds: [id] })),
		sequences: [{ id: 'main', rate: { num: 15, den: 1 }, trackIds: ['pictures-0', 'pictures-1'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	let archive;
	try {
		await store.writeMediaAsset(storageKey, new Blob([file.buffer], { type: file.mimeType }), { name: file.name, mimeType: file.mimeType });
		archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Video effect pixel previews require WebGL2.');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Pictures.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const preview = editor.locator('[data-video-preview]'), canvas = preview.locator('[data-video-preview-canvas]');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	await expect(preview.locator('[data-video-preview-clip]')).toHaveCount(2);
	const properties = await openClipProperties(page, editor, editor.getByRole('group', { name: 'Video clip: Underlying picture', exact: true }));
	const brightness = properties.locator('[data-video-effect-param="brightness"] input[type="number"]');
	await expect(brightness).toHaveValue('0');
	const before = await canvas.screenshot();
	await brightness.fill('0.4');
	await expect(brightness).toHaveValue('0.4');
	// Wait for the admitted preview's animation-frame publication without blurring/committing the field.
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	expect(await canvas.screenshot()).toEqual(before);
	await brightness.press('Escape'); await expect(brightness).toHaveValue('0');
});
