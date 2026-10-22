/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, openSourceMonitor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { clipSourceTrimFields } from '../../src/common/editor/clip-source-trim.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('Open as copy retains a hidden stretch marker when its source edge is extended', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob;
	try {
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const full = createAudioClip({ id: 'clip', title: 'Warped recording', sourceId: 'source', durationFrames: 48_000,
			sourceDurationFrames: 48_000, warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: 24_000, source: 12_000, mode: 'forward' },
				{ outer: 48_000, source: 48_000, mode: 'forward' },
			] } });
		const base = createSoundscaperProject({ id: 'copied-hidden-markers', sources: [source], clips: [full],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
		const project = createSoundscaperProject({ ...base, clips: [{ ...full, ...clipSourceTrimFields(base, full, source,
			{ sourceStartFrame: 24_000, sourceDurationFrames: 24_000, durationFrames: 16_000 }) }] });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Hidden stretch.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'copied-hidden-markers');
	await waitForProjectActivation(editor);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Hidden stretch.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
	await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', 'copied-hidden-markers');
	await waitForProjectActivation(editor);
	await editor.locator('[data-clip-id="clip"] .clip-header').click();
	const monitor = await openSourceMonitor(page, editor);
	await expect(monitor.locator('[data-source-frame-count]')).toHaveAttribute('data-source-frame-count', '48000');
	const start = monitor.getByRole('button', { name: 'Trim source start', exact: true });
	for (let step = 0; step < 5; step++) await start.press('Shift+ArrowLeft');
	await expect(monitor.locator('[data-source-sample="12000"]')).toHaveCount(1);
	for (let step = 0; step < 5; step++) await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(monitor.locator('[data-source-sample="12000"]')).toHaveCount(0);
	for (let step = 0; step < 5; step++) await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(monitor.locator('[data-source-sample="12000"]')).toHaveCount(1);
});
