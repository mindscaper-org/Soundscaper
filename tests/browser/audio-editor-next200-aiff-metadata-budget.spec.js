/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { strFromU8, unzipSync } from 'fflate';
import { aiffWithRepeatedAnnotations } from '../helpers/next200-aiff-metadata-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

let directory;
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'soundscaper-aiff-annotations-'));
	for (const count of [513, 2]) {
		const file = aiffWithRepeatedAnnotations(count, count === 513 ? 36 * 1024 : 1024 * 1024);
		await pipeline(Readable.fromWeb(file.stream()), createWriteStream(join(directory, `${count}.aiff`)));
	}
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

// Node retains the complete entry/aggregate-boundary matrix through Scape reopen.
// The browser still authenticates each input's read budget and saved native PCM.
test('File Import keeps safe tags and PCM across optional AIFF chunk budgets', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		const arrayBuffer = Blob.prototype.arrayBuffer;
		const slice = Blob.prototype.slice;
		const ranges = new WeakMap();
		const inputName = blob => blob instanceof File && blob.name.endsWith('.aiff') ? blob.name : ranges.get(blob);
		window.aiffMetadataPayloadBytes = {};
		Blob.prototype.slice = function (start, end, type) {
			const range = slice.call(this, start, end, type);
			if (inputName(this)) ranges.set(range, inputName(this));
			return range;
		};
		Blob.prototype.arrayBuffer = function () {
			const name = inputName(this);
			if (name && this.size >= 32 * 1024) window.aiffMetadataPayloadBytes[name] = (window.aiffMetadataPayloadBytes[name] ?? 0) + this.size;
			return arrayBuffer.call(this);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles([513, 2].map(count => join(directory, `${count}.aiff`)));
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const download = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await download));
	const project = JSON.parse(strFromU8(files['project.json']));
	expect(project.sources).toHaveLength(2);
	for (const count of [513, 2]) {
		const source = project.sources.find(source => source.name === `${count}.aiff`); expect(source).toBeDefined();
		const contribution = source.provenance.contributions[0];
		expect(contribution.metadata.normalized.title).toBe('Retained title');
		expect(contribution.warnings.some(warning => warning.includes('aggregate'))).toBe(count === 513);
		expect(await page.evaluate(name => window.aiffMetadataPayloadBytes[name] ?? 0, `${count}.aiff`)).toBeLessThanOrEqual(17 * 1024 * 1024);
		expect(source).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
		const pcm = Buffer.from(files[`audio/${source.id}.f32c`]); expect(pcm.readUInt32LE(0)).toBe(4800);
		for (let index = 0; index < 4800; index++) expect(pcm.readFloatLE(4 + index * 4)).toBe(.25);
	}
});
