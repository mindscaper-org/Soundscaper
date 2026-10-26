/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createMonoCameraFixture } from './fixtures/mono-camera-media.js';
import { ordinaryOggOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

for (const operation of ['tone', 'nyquist', 'invert', 'encoded import', 'camera import']) test(`${operation} retains committed audio after a waveform-cache write failure`, async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const source = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: 24_000, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `waveform-publication-${operation}`, masterChannels: 1, ...(operation === 'invert' ? {
		sources: [source], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 24_000, sourceDurationFrames: 24_000 })],
	} : {}) });
	let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(24_000).fill(.25)]); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await page.addInitScript(() => {
		globalThis.__waveformCacheFault = { enabled: false, count: 0 };
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (...args) {
			if (globalThis.__waveformCacheFault.enabled && this.name === 'analysis'
				&& String(args[0]?.key).startsWith('audio-editor-peaks-v2:')) {
				globalThis.__waveformCacheFault.count++;
				throw new DOMException('Waveform cache full', 'QuotaExceededError');
			}
			return Reflect.apply(original, this, args);
		};
	});
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Healthy.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const original = operation === 'invert' ? await exportSamples(page, editor) : null;
	await page.evaluate(() => { globalThis.__waveformCacheFault.enabled = true; });
	if (operation === 'tone') {
		await chooseCommandAction(page, editor, 'Generate', 'Tone');
		const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
		await dialog.locator('[data-generator-field="durationSeconds"] .timecode-digit').first().click();
		await page.keyboard.type('000000500'); await page.keyboard.press('Enter');
		await dialog.getByRole('button', { name: 'Generate', exact: true }).click(); await expect(dialog).toBeHidden();
	} else if (operation === 'nyquist') {
		await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
		const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
		await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('(scale .25 (osc 60 .5))');
		await dialog.getByRole('button', { name: 'Run', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	} else if (operation === 'invert') {
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
	} else {
		const encoded = operation === 'encoded import' ? await ordinaryOggOpusFixture() : null;
		await importFiles(editor, [encoded ? { name: 'Microphone.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(await encoded.arrayBuffer()) }
			: createMonoCameraFixture('Camera.webm')]);
	}
	expect(await page.evaluate(() => globalThis.__waveformCacheFault.count)).toBeGreaterThan(0);
	await expect(editor).toHaveAttribute('data-clip-count', operation === 'camera import' ? '2' : '1');
	const samples = await exportSamples(page, editor); expect(samples.length).toBeGreaterThan(1000);
	expect(Math.max(...samples.slice(0, 48_000).map(Math.abs))).toBeGreaterThan(.05);
	if (original) expect(samples[200]).toBeCloseTo(-original[200], 4);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', operation === 'invert' ? '1' : '0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', operation === 'camera import' ? '2' : '1');
});
