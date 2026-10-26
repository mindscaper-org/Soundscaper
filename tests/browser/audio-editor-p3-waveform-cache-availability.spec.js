/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, waitForProjectActivation, openClipProperties, closeClipProperties, clipField } from './audio-editor-test-helpers.js';
import { expectClipSampleRate, resampleClipFormat } from './audio-editor-clip-settings-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

for (const failure of ['read', 'write', 'none']) test(`stored audio remains available with optional waveform cache ${failure} failure`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', name: 'Healthy recording', sampleRate: 48_000, frameCount: 24_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `cache-${failure}`, title: 'Healthy recording', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Healthy recording', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 24_000 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(24_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Healthy.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await page.addInitScript(fault => {
		globalThis.__waveformCacheFault = { enabled: false, count: 0 };
		const method = fault === 'read' ? 'get' : 'put', original = IDBObjectStore.prototype[method];
		IDBObjectStore.prototype[method] = function (...args) {
			const key = method === 'get' ? args[0] : args[0]?.key;
			if (fault !== 'none' && globalThis.__waveformCacheFault.enabled && this.name === 'analysis'
				&& typeof key === 'string' && key.startsWith('audio-editor-peaks-v2:')) {
				globalThis.__waveformCacheFault.count++;
				throw new DOMException('Waveform cache is full', 'QuotaExceededError');
			}
			return Reflect.apply(original, this, args);
		};
	}, failure);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await page.evaluate(() => { globalThis.__waveformCacheFault.enabled = true; });
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	if (failure !== 'none') expect(await page.evaluate(() => globalThis.__waveformCacheFault.count)).toBeGreaterThan(0);
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBeGreaterThan(20_000); expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(.1);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading; expect(download.suggestedFilename()).toMatch(/\.sscape$/u);
});

for (const operation of ['resample', 'render']) test(`${operation} keeps healthy PCM when its waveform cache cannot be saved`, async ({ page }) => {
	const source = createAudioSource({ id: 'original', name: 'Original.wav', sampleRate: 48_000, frameCount: 24_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `publication-cache-${operation}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', sourceDurationFrames: 24_000,
			durationFrames: operation === 'render' ? 12_000 : 24_000, speedRatio: operation === 'render' ? 2 : 1, linkPitchAndTempo: true })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(24_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await page.addInitScript(() => {
		globalThis.__waveformCacheFault = { enabled: false, count: 0 };
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (...args) {
			if (globalThis.__waveformCacheFault.enabled && this.name === 'analysis'
				&& String(args[0]?.key).startsWith('audio-editor-peaks-v2:')) {
				globalThis.__waveformCacheFault.count++; throw new DOMException('Waveform cache full', 'QuotaExceededError');
			}
			return Reflect.apply(original, this, args);
		};
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await page.evaluate(() => { globalThis.__waveformCacheFault.enabled = true; });
	const clip = editor.locator('[data-clip-id="clip"]').first();
	if (operation === 'render') {
		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
		const properties = await openClipProperties(page, editor, clip);
		await expect(clipField(properties, 'speedRatio')).toHaveValue('100'); await closeClipProperties(properties);
	} else {
		const properties = await openClipProperties(page, editor, clip);
		await resampleClipFormat(properties, 96_000); await expectClipSampleRate(properties, 96_000); await closeClipProperties(properties);
	}
	expect(await page.evaluate(() => globalThis.__waveformCacheFault.count)).toBeGreaterThan(0);
	const samples = await exportSamples(page, editor); expect(samples.length).toBeGreaterThan(10_000);
	expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(.1);
});

test('legacy AUP import retains its decoded audio when the waveform cache is full', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__waveformCacheFault = { enabled: false, count: 0 };
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (...args) {
			if (globalThis.__waveformCacheFault.enabled && this.name === 'analysis'
				&& String(args[0]?.key).startsWith('audio-editor-peaks-v2:')) {
				globalThis.__waveformCacheFault.count++; throw new DOMException('Waveform cache full', 'QuotaExceededError');
			}
			return Reflect.apply(original, this, args);
		};
	});
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-legacy-cache-'));
	const dataDirectory = join(directory, 'Été 演奏 🎙_data');
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	await mkdir(dataDirectory); await writeFile(join(dataDirectory, dataFile.name), new Uint8Array(await dataFile.arrayBuffer()));
	try {
		await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
		await page.evaluate(() => { globalThis.__waveformCacheFault.enabled = true; });
		const choosing = page.waitForEvent('filechooser');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: projectFile.name, mimeType: projectFile.type,
			buffer: Buffer.from(await projectFile.arrayBuffer()) });
		await (await choosing).setFiles(dataDirectory);
		await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
		await waitForProjectActivation(editor);
		expect(await page.evaluate(() => globalThis.__waveformCacheFault.count)).toBeGreaterThan(0);
		const samples = await exportSamples(page, editor);
		expect(samples).toHaveLength(4800);
		expect(samples[0]).toBeCloseTo(.25 * Math.SQRT1_2, 5);
		expect(samples[1]).toBeCloseTo(-.25 * Math.SQRT1_2, 5);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
