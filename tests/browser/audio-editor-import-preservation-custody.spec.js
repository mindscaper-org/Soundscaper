/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker,
	downloadBytes, waitForEditor, waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

// The Node import tests exercise individual filename and literal-key variants
// through Scape export and reopen. This batch retains the real chooser, MP3
// decode, PCM rendering, browser persistence and native Save paths for every input.
test('File Import preserves unusual filenames and literal credits through Save and reload', async ({ page }) => {
	test.setTimeout(90_000);
	const waveNames = ['   .wav', ' Voice .wav'];
	const keys = ['$soundscaperOpaqueBinary', 'OrdinaryCredit'];
	const wave = Buffer.from(encodeWav([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)],
		{ sampleRate: 48_000, float: true }));
	const audio = Buffer.from(await readFile(new URL('../fixtures/ffmpeg-libmp3lame-one-second.mp3.base64', import.meta.url), 'utf8'), 'base64');
	const files = [
		...waveNames.map(name => ({ name, mimeType: 'audio/wav', buffer: wave })),
		...keys.map((key, index) => {
			const payload = Buffer.from(`\x03${key}\0Reviewed credit`, 'utf8');
			const frame = Buffer.alloc(10); frame.write('TXXX'); frame[7] = payload.length;
			const header = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 10 + payload.length]);
			return { name: `Credits-${index}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.concat([header, frame, payload, audio]) };
		}),
	];
	await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(files);
	await expect(editor).toHaveAttribute('data-clip-count', '4', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	for (const reload of [false, true]) {
		if (reload) { await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor); }
		await expect(editor).toHaveAttribute('data-clip-count', '4');
		const rendered = await exportSamples(page, editor);
		const downloading = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const download = await downloading;
		let bytes;
		try { bytes = await downloadBytes(download); } finally { await download.delete(); }
		const entries = unzipSync(bytes);
		const project = parseScapeProjectDocument(strFromU8(entries['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
		expect(project.sources).toHaveLength(4); expect(project.clips).toHaveLength(4);
		expect(project.featureRequirements.requirements.some(row => row.featureId === 'org.soundscaper.capability.literal-json-keys')).toBe(true);
		let expectedMix = 0, expectedLength = 0;
		for (const [index, file] of files.entries()) {
			const source = project.sources.find(source => source.name === file.name);
			expect(source, file.name).toBeDefined();
			expect(source.sampleRate).toBe(48_000);
			const contribution = source.provenance.contributions[0];
			expect(contribution.origin).toMatchObject({ kind: 'local-file', originalFileName: file.name, byteLength: file.buffer.length });
			const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]);
			expect(pcm.readUInt32LE(0)).toBe(source.frameCount);
			// A centered mono track contributes -3 dB to each stereo channel.
			expectedMix += pcm.readFloatLE(4 + 2000 * 4) * (source.channelCount === 1 ? Math.SQRT1_2 : 1);
			expectedLength = Math.max(expectedLength, source.frameCount);
			if (index < waveNames.length) {
				expect(source).toMatchObject({ channelCount: 2, frameCount: 4800 });
				for (const [channel, value] of [.25, -.125].entries()) expect(Array.from({ length: 4800 },
					(_, frame) => pcm.readFloatLE(4 + (channel * 4800 + frame) * 4))).toEqual(new Array(4800).fill(value));
				const clip = project.clips.find(clip => clip.sourceId === source.id);
				const track = project.tracks.find(track => track.type === 'audio' && track.clipIds.includes(clip.id));
				expect(track.name.trim()).not.toBe(''); expect(clip.title).toBe(track.name);
				if (file.name === ' Voice .wav') expect(track.name).toBe(' Voice ');
			} else {
				expect(contribution.metadata.raw.TXXX[keys[index - waveNames.length]]).toBe('Reviewed credit');
				const samples = Array.from({ length: source.frameCount }, (_, frame) => pcm.readFloatLE(4 + frame * 4));
				expect(Math.max(...samples)).toBeGreaterThan(.05);
			}
		}
		expect(rendered).toHaveLength(expectedLength);
		expect(rendered[2000]).toBeCloseTo(expectedMix, 4);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	}
});
