/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Paste creates a destination track in a lower-rate native project', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob, destinationBlob;
	try {
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'paste-track-rate', sources: [source],
			clips: [createAudioClip({ id: 'clip', title: 'Recording', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
		destinationBlob = (await exportScapeProject(createSoundscaperProject({ id: 'clipboard-24k', sampleRate: 24_000 }), store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Hidden stretch.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'paste-track-rate');
	await waitForProjectActivation(editor);
	await editor.locator('[data-clip-id="clip"] .clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: '24k.sscape', mimeType: 'application/zip', buffer: Buffer.from(await destinationBlob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'clipboard-24k');
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(1);
	await expect.poll(async () => (await persistedProject(page, 'clipboard-24k'))?.clips[0]?.durationFrames).toBe(24_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(1);
});

for (const action of ['bin', 'import', 'generate', 'move', 'nyquist']) test(`${action} creates a track at the lower-rate project clock`, async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob;
	try {
		const source = createAudioSource({ id: 'source', sampleRate: 24_000, frameCount: 24_000, channelCount: 1 });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(24_000).fill(.25)]); await writer.commit();
		const project = createSoundscaperProject({ id: `rate-${action}`, sampleRate: 24_000,
			...(action === 'move' ? { sources: [source], clips: [createAudioClip({ id: 'clip', title: 'Recording', sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 })],
				tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 24_000)] } : {}),
			...(action === 'bin' ? { sources: [source], projectBin: { clips: [createAudioClip({ id: 'bin-clip', binItemId: 'recording', title: 'Recording',
				sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 })] } } : {}) });
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: '24k.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', `rate-${action}`); await waitForProjectActivation(editor);
	if (action === 'bin') {
		if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Project bin']);
		await editor.locator('[data-project-bin-item="recording"]').getByRole('button', { name: 'Add to timeline: Recording', exact: true }).click();
	} else if (action === 'generate') {
		await chooseCommandAction(page, editor, 'Generate', 'Tone');
		await page.getByRole('dialog', { name: 'Tone', exact: true }).getByRole('button', { name: 'Generate', exact: true }).click();
	} else if (action === 'nyquist') {
		await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Risset Drum']);
		const dialog = page.getByRole('dialog', { name: 'Risset Drum', exact: true });
		await dialog.getByRole('spinbutton', { name: /^Decay \(seconds\)/u }).fill('1');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
	} else if (action === 'move') {
		const clip = editor.locator('[data-clip-id="clip"]');
		await clip.scrollIntoViewIfNeeded();
		const box = await clip.boundingBox();
		const inner = await editor.locator('.audio-editor-timeline-inner').boundingBox();
		const lastTrack = await editor.locator('.audio-editor-track-row').last().boundingBox();
		expect(box).not.toBeNull(); expect(inner).not.toBeNull(); expect(lastTrack).not.toBeNull();
		const targetY = Math.min(inner.y + inner.height - 16, lastTrack.y + lastTrack.height + 32);
		await page.mouse.move(box.x + 32, box.y + 10); await page.mouse.down();
		await page.mouse.move(box.x + 32, targetY, { steps: 6 });
		await expect(editor.locator('.audio-editor-new-track-drop-preview')).toBeVisible(); await page.mouse.up();
		await expect(editor).toHaveAttribute('data-track-count', '2');
	} else await editor.locator('[data-import-input]').setInputFiles({ name: 'Recording.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav(
		[new Float32Array(24_000).fill(.25)], { sampleRate: 24_000, float: true })) });
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(1);
	await expect.poll(async () => (await persistedProject(page, `rate-${action}`))?.clips[0]?.durationFrames).toBe(action === 'generate' ? 720_000 : 24_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(action === 'move' ? 1 : 0);
	if (action === 'move') await expect(editor).toHaveAttribute('data-track-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(1);
});
