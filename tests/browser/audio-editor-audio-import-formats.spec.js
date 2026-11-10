/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { AUDIO_IMPORT_FORMATS as FORMATS, encodedAudioImportFixture, extendedWaveImportFixture as extendedWavFixture } from '../helpers/audio-format-import-cases.ts';
import {
	bootEditor, chooseFileAction, collectClientErrors, registerAudioEditorHooks,
	sourcePeakChannels, waitForEditor, clipByName,
} from './audio-editor-test-helpers.js';

async function encodedFixture(extension, codec, mimeType) {
	const fixture = await encodedAudioImportFixture(extension, codec, mimeType);
	return { name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer };
}

async function importThroughFileMenu(page, editor, file) {
	const choosingFile = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosingFile).setFiles(file);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
}

test.describe('audio file import formats', () => {
	registerAudioEditorHooks();
	test('File > Import and Project Bin advertise maintained audio suffixes and import .wave aliases', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-workspace-panel="project-bin"]')).toBeVisible();
		const requiredExtensions = [
			'.aac', '.aif', '.aifc', '.aiff', '.bw64', '.bwf', '.flac', '.m4a', '.mp2', '.mp3',
			'.oga', '.ogg', '.opus', '.rf64', '.wav', '.wave', '.wavpack', '.wv',
		];
		const projectBinChoosingFile = page.waitForEvent('filechooser');
		await editor.getByText('Add audio to Project bin', { exact: true }).click();
		const projectBinChooser = await projectBinChoosingFile;
		const projectBinAccepted = new Set((await projectBinChooser.element().getAttribute('accept')).split(','));
		for (const extension of requiredExtensions) {
			expect(projectBinAccepted, `Project Bin must advertise ${extension}`).toContain(extension);
		}
		const wav = createWavFixture({ name: 'source.wav', frequency: 330, channelAmplitudes: [0.3, 0.1] });
		await projectBinChooser.setFiles({ ...wav, name: 'project-bin-field-recording.wave', mimeType: '' });
		await expect(editor.locator('[data-project-bin-name]')).toHaveValue('project-bin-field-recording');
		const choosingFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		const chooser = await choosingFile;
		const accepted = new Set((await chooser.element().getAttribute('accept')).split(','));
		for (const extension of requiredExtensions) {
			expect(accepted, `File > Import must advertise ${extension}`).toContain(extension);
		}
		await chooser.setFiles({ ...wav, name: 'field-recording.wave', mimeType: '' });
		await expect(clipByName(editor, 'field-recording.wave')).toBeVisible();
		await expect.poll(async () => (await sourcePeakChannels(page, 'field-recording.wave')).channelCount).toBe(2);
		const peaks = await sourcePeakChannels(page, 'field-recording.wave');
		expect(peaks.channelCount).toBe(2);
		expect(peaks.channels[0].maximum).toBeCloseTo(0.3, 3);
		expect(peaks.channels[1].maximum).toBeCloseTo(0.1, 3);
	});

	test('File > Import bypasses a visible Project bin and creates one track per file', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-workspace-panel="project-bin"]')).toBeVisible();
		const choosingFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		const first = createWavFixture({ name: 'first-track.wav', frequency: 220 });
		const second = createWavFixture({ name: 'second-track.wav', frequency: 440 });
		await (await choosingFile).setFiles([first, second]);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
		const firstClip = clipByName(editor, first.name);
		const secondClip = clipByName(editor, second.name);
		await expect(firstClip).toBeVisible();
		await expect(secondClip).toBeVisible();
		expect(await firstClip.getAttribute('data-track-index'))
			.not.toBe(await secondClip.getAttribute('data-track-index'));
	});

	test('File Open accepts an Ogg container MIME without an audio filename suffix', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const initialId = await editor.getAttribute('data-project-id');
		const encoded = await encodedFixture('ogg', 'libvorbis', 'application/ogg');
		const choosingFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosingFile).setFiles({ ...encoded, name: 'downloaded-original' });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
		expect(await editor.getAttribute('data-project-id')).not.toBe(initialId);
		await expect.poll(async () => (await sourcePeakChannels(page, 'downloaded-original')).channelCount).toBe(2);
		const peaks = await sourcePeakChannels(page, 'downloaded-original');
		expect(peaks.channelCount).toBe(2);
		expect(peaks.channels[0].maximum).toBeGreaterThan(0.2);
	});

	// The two ds64 forms have independent controller/store/archive PCM custody in Node.
	test('RF64 and BW64 import through one File chooser and survive reload independently', async ({ page }) => {
		const errors = collectClientErrors(page);
		const files = ['RF64', 'BW64'].map(signature => {
			const fixture = extendedWavFixture(signature);
			return { name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer };
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importThroughFileMenu(page, editor, files);
		const originals = new Map();
		for (const file of files) {
			await expect(clipByName(editor, file.name)).toBeVisible();
			await expect.poll(async () => (await sourcePeakChannels(page, file.name)).channelCount).toBe(2);
			const peaks = await sourcePeakChannels(page, file.name);
			expect(peaks.channelCount).toBe(2);
			expect(peaks.channels[0].maximum).toBeGreaterThan(0.2);
			expect(peaks.channels[1].maximum).toBeGreaterThan(0.05);
			originals.set(file.name, peaks);
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restored = await waitForEditor(page);
		for (const file of files) {
			await expect(clipByName(restored, file.name)).toBeVisible();
			expect(await sourcePeakChannels(page, file.name)).toEqual(originals.get(file.name));
		}
		expect(errors).toEqual([]);
	});

	test('a failed dedicated FLAC decode leaves the project untouched and the next import succeeds', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const initialProjectId = await editor.getAttribute('data-project-id');
		const choosingBadFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		await (await choosingBadFile).setFiles({
			name: 'broken-import.flac',
			mimeType: 'audio/flac',
			buffer: Buffer.from('fLaCbroken-payload'),
		});
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]'))
			.toContainText('1 failed', { timeout: 20_000 });
		await expect(editor).toHaveAttribute('data-project-id', initialProjectId);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(editor.locator('[data-project-bin-item]')).toHaveCount(0);

		const valid = await encodedFixture('flac', 'flac', 'audio/flac');
		await importThroughFileMenu(page, editor, valid);
		await expect(clipByName(editor, valid.name)).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	});

	// Payload variations have independent real-decoder/controller/Scape custody in Node.
	// Keep actual native AAC/M4A, worker codec loading, playback and IndexedDB reload here.
	test('all maintained formats import stereo audio, play and survive reload together', async ({ page }) => {
		test.setTimeout(FORMATS.length * 60_000);
		const files = [];
		for (const [label, extension, codec, mimeType] of FORMATS) {
			await test.step(`prepare ${label}`, async () => {
				const file = await encodedFixture(extension, codec, mimeType);
				files.push({ ...file, name: `${extension}-import.${extension}` });
			}, { timeout: 60_000 });
		}
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const choosingFile = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		await (await choosingFile).setFiles(files);
		const originals = new Map();
		for (const file of files) {
			await test.step(`decoded ${file.name}`, async () => {
				await expect(clipByName(editor, file.name)).toBeVisible({ timeout: 20_000 });
				await expect.poll(async () => (await sourcePeakChannels(page, file.name)).channelCount).toBe(2);
				const peaks = await sourcePeakChannels(page, file.name);
				expect(peaks.channelCount).toBe(2);
				expect(peaks.channels[0].maximum).toBeGreaterThan(0.2);
				expect(peaks.channels[0].minimum).toBeLessThan(-0.2);
				expect(peaks.channels[1].maximum).toBeGreaterThan(0.05);
				expect(peaks.channels[1].maximum).toBeLessThan(0.2);
				originals.set(file.name, peaks);
			}, { timeout: 60_000 });
		}
		await expect(editor).toHaveAttribute('data-clip-count', String(files.length));
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restored = await waitForEditor(page);
		for (const file of files) {
			await test.step(`restored ${file.name}`, async () => {
				await expect(clipByName(restored, file.name)).toBeVisible();
				expect(await sourcePeakChannels(page, file.name)).toEqual(originals.get(file.name));
			}, { timeout: 60_000 });
		}
		expect(errors).toEqual([]);
	});

});
