/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, openClipProperties,
	openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { expectClipSampleRate } from './audio-editor-clip-settings-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const operation of ['merge', 'split', 'track-resample', 'clip-resample', 'render']) for (const microfades of [false, true]) {
	test(`${operation} preserves authored endpoints with new-clip fades ${microfades}`, async ({ page }) => {
		const { project, blob } = await projectArchive(operation, microfades);
		await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
		if (!microfades) {
			await chooseCommandAction(page, editor, 'Edit', 'Preferences');
			const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
			await preferences.getByRole('tab', { name: /Editing$/u }).click();
			await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
			await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		}
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Authored.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		const before = await samples(page, editor);
		await editor.locator('[data-clip-id="left-clip"] .clip-header').click();
		if (operation === 'merge' || operation === 'split') {
			await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row][data-track-id="left"]'),
				['Track channels', operation === 'merge' ? 'Make stereo track' : 'Split stereo to left/right mono']);
		} else if (operation === 'track-resample') {
			await chooseCommandAction(page, editor, 'Tracks', 'Resample');
			const dialog = page.getByRole('dialog', { name: 'Resample', exact: true });
			await dialog.getByRole('textbox').fill('24000');
			await dialog.getByRole('button', { name: 'Resample', exact: true }).click(); await expect(dialog).toBeHidden();
		} else if (operation === 'render') {
			await editor.locator('[data-clip-id="left-clip"]').first().getByRole('button', { name: 'Clip menu', exact: true }).click();
			await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
			await expect.poll(async () => (await persistedProject(page, project.id)).clips[0].speedRatio).toBe(1);
		} else {
			const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id="left-clip"]').first());
			await properties.getByRole('button', { name: 'Media settings', exact: true }).click();
			await page.getByRole('menuitem', { name: 'Resample', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Resample clip', exact: true });
			await dialog.locator('[data-clip-resample-field="sampleRate"] input').fill('24000');
			await dialog.getByRole('button', { name: 'Resample', exact: true }).click(); await expect(dialog).toBeHidden();
			// The chooser closes before its asynchronous source rewrite completes.
			await expectClipSampleRate(properties, 24_000);
		}
		await expect(editor).toHaveAttribute('data-clip-count', operation === 'split' ? '2' : '1');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
		const after = await samples(page, editor);
		const current = await persistedProject(page, project.id);
		expect(current.clips.map(clip => [clip.fadeInFrames, clip.fadeOutFrames])).toEqual(current.clips.map(() => [0, 0]));
		assertPcm(after, before);
		await chooseCommandAction(page, editor, 'Edit', 'Undo'); assertPcm(await samples(page, editor), before);
		await chooseCommandAction(page, editor, 'Edit', 'Redo'); assertPcm(await samples(page, editor), after);
	});
}

function assertPcm(actual, expected) {
	expect(actual).toHaveLength(expected.length);
	expect(actual.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - expected[frame])), 0)).toBeLessThan(.0001);
}

async function samples(page, editor) {
	const dialog = await openExportDialog(page, editor), link = dialog.locator('[data-export-download]');
	const previous = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 }); await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	const pcm = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const buffer = await context.decodeAudioData(new Uint8Array(data).buffer), result = [];
			for (let frame = 0; frame < buffer.length; frame += 1) for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) result.push(buffer.getChannelData(channel)[frame]);
			return result;
		} finally { await context.close(); }
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click(); return pcm;
}

async function projectArchive(operation, microfades) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: operation === 'render' ? 9600 : 4800, channelCount: operation === 'split' ? 2 : 1 });
	const clips = (operation === 'merge' ? ['left', 'right'] : ['left']).map(id => createAudioClip({ id: `${id}-clip`,
		sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800,
		...(operation === 'render' ? { sourceStartFrame: 2400, durationFrames: 2400, speedRatio: 2, linkPitchAndTempo: true } : {}), fadeInFrames: 0, fadeOutFrames: 0 }));
	const project = createSoundscaperProject({ id: `channel-fades-${operation}-${microfades}`, sources: [source], clips,
		tracks: clips.map((clip, index) => createAudioTrack({ id: index ? 'right' : 'left', name: index ? 'Right' : 'Left',
			pan: operation === 'merge' ? (index ? 1 : -1) : 0, clipIds: [clip.id] })) });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write(Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount).fill(.25)));
		await writer.commit(); const { blob } = await exportScapeProject(project, store); expect(blob).toBeTruthy(); return { project, blob };
	} finally { await store.close(); }
}
