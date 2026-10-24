/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const sourceRate of [44_100, 48_000]) test(`Freesound describes a clip rendered from ${sourceRate} Hz using its delivered duration`, async ({ page }) => {
	await page.addInitScript(() => {
		const fetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			if (new URL(String(input), location.href).pathname === '/api/freesound/uploads' && init?.body instanceof Blob) {
				globalThis.__durationUploadBytes = Array.from(new Uint8Array(await init.body.arrayBuffer()));
			}
			return Reflect.apply(fetch, globalThis, [input, init]);
		};
	});
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		const data = path.endsWith('/oauth/session') ? { connected: true, user: { id: 7, username: 'recorder' } }
			: path.endsWith('/uploads/pending') ? { pendingDescription: [], pendingProcessing: [], pendingModeration: [] }
				: { uploadFilename: 'remote-clip.wav' };
		await route.fulfill({ json: { data } });
	});
	const source = createAudioSource({ id: 'source', name: 'Recording.wav', sampleRate: sourceRate, frameCount: sourceRate / 10, channelCount: 1 });
	const title = sourceRate === 48_000 ? `${'A'.repeat(511)}🎙` : 'Short take';
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title, sourceStartFrame: 0,
		sourceDurationFrames: sourceRate / 10, timelineStartFrame: 0, durationFrames: 4800, binItemId: 'clip' }, { projectSampleRate: 48_000 });
	const project = createSoundscaperProject({ id: `upload-clock-${sourceRate}`, sampleRate: 48_000, sources: [source], clips: [],
		projectBin: { clips: [clip] }, tracks: [createAudioTrack({ id: 'voice' })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let buffer;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: sourceRate / 10 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / sourceRate))]);
		await writer.commit(); const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store);
		buffer = Buffer.from(await archive.blob.arrayBuffer());
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Clip.sscape', mimeType: 'application/zip', buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor.locator('[data-project-bin-item]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as recorder', { exact: true })).toBeVisible();
	await editor.locator('[data-project-bin-item]').getByRole('button', { name: /^More file actions:/u }).press('Enter');
	await page.locator('.kw-audio-editor__project-bin-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
	await expect(panel.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(1);
	const wav = await inspectWavBlobPcm(new Blob([Uint8Array.from(await page.evaluate(() => globalThis.__durationUploadBytes))]));
	expect(wav).toMatchObject({ frameCount: 4800, sampleRate: 48_000 });
	await panel.getByRole('button', { name: /^Ready to publish/u }).click();
	const dialog = page.getByRole('dialog', { name: 'Publish to Freesound', exact: true });
	await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(sourceRate === 48_000 ? 'A'.repeat(511) : title);
	await expect(dialog.getByRole('textbox', { name: 'Description', exact: true }))
		.toHaveValue(new RegExp(`${(wav.frameCount / wav.sampleRate).toFixed(3).replace('.', '\\.')} seconds`, 'u'));
});
