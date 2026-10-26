/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

for (const encoding of ['utf-16le', 'utf-16be']) test(`File Open imports ${encoding} legacy AUP with its selected AU directory`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-legacy-xml-'));
	const dataDirectory = join(directory, 'Été 演奏 🎙_data');
	const { projectFile, dataFile } = legacyAupFiles(encoding);
	await mkdir(dataDirectory);
	await writeFile(join(dataDirectory, dataFile.name), new Uint8Array(await dataFile.arrayBuffer()));
	try {
		const editor = await bootEditor(page, '/embed/en/');
		const choosingData = page.waitForEvent('filechooser');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: projectFile.name, mimeType: projectFile.type,
			buffer: Buffer.from(await projectFile.arrayBuffer()) });
		await (await choosingData).setFiles(dataDirectory);
		await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
		const download = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const entries = unzipSync(await downloadBytes(await download));
		const saved = JSON.parse(strFromU8(entries['project.json']));
		expect(saved.tracks.find(track => track.type === 'audio').name).toBe('Voix 日本語 🎙');
		expect(saved.timelineAnnotations[0]).toMatchObject({ name: 'Repère 日本語 🎵', startFrame: 1200, endFrame: 2400 });
		expect(saved.sources[0]).toMatchObject({ frameCount: 4800, sampleRate: 48_000, channelCount: 1 });
		const pcm = Object.entries(entries).find(([name]) => name.endsWith('.f32c'))?.[1];
		expect(pcm).toBeDefined();
		const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
		expect(samples.getUint32(0, true)).toBe(4800);
		expect(samples.getFloat32(4, true)).toBe(0.25);
		expect(samples.getFloat32(8, true)).toBe(-0.25);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
