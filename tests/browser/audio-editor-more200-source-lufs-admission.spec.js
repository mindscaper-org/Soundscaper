/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseDropdown, disableNativeSavePicker, openSourceMonitor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const rms = samples => Math.sqrt(samples.slice(12_000, 72_000).reduce((sum, sample) => sum + sample * sample, 0) / 60_000);
for (const rate of [3000, 8000]) test(`Source Monitor loudness preserves admitted PCM at ${rate}Hz`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', sampleRate: rate, frameCount: rate * 2, channelCount: 1 });
	const project = createSoundscaperProject({ id: `lufs-${rate}`, sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 96_000, sourceDurationFrames: rate * 2 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: rate * 2 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 500 * frame / rate))]);
		await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Low rate.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(rms(before)).toBeGreaterThan(.09);
	const panel = await openSourceMonitor(page, editor, editor.locator('[data-clip-id="clip"]'));
	await panel.getByRole('region', { name: 'Source waveform', exact: true }).press('Control+a');
	await expect(panel.locator('.audio-editor-source-selection')).toHaveCount(1);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Loudness Normalization']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	if (rate < 8000) {
		await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog.getByRole('alert')).toContainText('8000');
		await expect(dialog.getByRole('alert')).toContainText('RMS');
		await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		const retained = await exportSamples(page, editor); expect(retained).toHaveLength(before.length);
		expect(Math.max(...retained.map((sample, index) => Math.abs(sample - before[index])))).toBeLessThan(.00001);
		await panel.getByRole('region', { name: 'Source waveform', exact: true }).press('Control+a');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Loudness Normalization']);
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Normalize', exact: true }), 'RMS');
	}
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	const ratio = rms(after) / rms(before);
	expect(ratio).toBeGreaterThan(rate < 8000 ? .70 : .3);
	expect(ratio).toBeLessThan(rate < 8000 ? .72 : .5);
});
