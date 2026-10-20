/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { unzipSync } from 'fflate';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const length of [4, 15]) test(`an ordinary ${length === 4 ? 'short' : 'long'} Japanese track title exports extractable WAV stems`, async ({ page }, testInfo) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const title = '東京での録音'.repeat(length);
	await editor.getByRole('button', { name: 'Rename track: browser-tone-a', exact: true }).dblclick();
	const name = editor.locator('[data-track-name] input');
	await expect(name).toBeVisible();
	await name.fill(title);
	await name.press('Enter');
	await expect(editor.getByRole('button', { name: `Rename track: ${title}`, exact: true })).toBeVisible();
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Individual stems (split by tracks)');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const entries = Object.entries(unzipSync(bytes));
	const expectedContents = new Map(entries);
	expect(entries).toHaveLength(2);
	const imported = entries.find(([fileName]) => fileName.startsWith('02-'));
	expect(imported).toBeDefined();
	expect(imported[0]).toMatch(/^02-東京での録音.*\.wav$/u);
	const audio = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const decoded = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return { frames: decoded.length, channels: decoded.numberOfChannels, peak: Math.max(...decoded.getChannelData(0)) };
		} finally { await context.close(); }
	}, Array.from(imported[1]));
	expect(audio.frames).toBe(38_400);
	expect(audio.channels).toBe(2);
	expect(audio.peak).toBeGreaterThan(.1);
	await testInfo.attach('archive-members.json', { body: JSON.stringify({ title, audio, names: entries.map(([fileName]) => ({ fileName, bytes: Buffer.byteLength(fileName) })) }), contentType: 'application/json' });
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-export-name-'));
	try {
		// Decode independently of fflate, then exercise the host filesystem using
		// the reference reader's names, including the complete UTF-8 basenames.
		const archive = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false, checkSignature: true });
		try {
			const extracted = await archive.getEntries();
			expect(extracted.map(entry => entry.filename)).toEqual(entries.map(([fileName]) => fileName));
			for (const entry of extracted) {
				expect(entry.directory).toBe(false);
				expect(Buffer.byteLength(entry.filename)).toBeLessThanOrEqual(255);
				const content = await entry.getData(new Uint8ArrayWriter());
				await writeFile(join(directory, entry.filename), content);
				expect(await readFile(join(directory, entry.filename))).toEqual(Buffer.from(expectedContents.get(entry.filename)));
			}
		} finally { await archive.close(); }
	} finally { await rm(directory, { recursive: true, force: true }); }
});
