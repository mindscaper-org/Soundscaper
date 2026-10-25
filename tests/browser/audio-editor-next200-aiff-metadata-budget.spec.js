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
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

let directory;
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'soundscaper-aiff-annotations-'));
	for (const count of [513, 2]) {
		const file = aiffWithRepeatedAnnotations(count, count === 513 ? 36 * 1024 : 1024 * 1024);
		await pipeline(Readable.fromWeb(file.stream()), createWriteStream(join(directory, `${count}.aiff`)));
	}
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

for (const count of [513, 2]) test(`File Import keeps safe tags and PCM with ${count} optional AIFF chunks`, async ({ page }) => {
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		const arrayBuffer = Blob.prototype.arrayBuffer;
		const slice = Blob.prototype.slice;
		const ranges = new WeakSet();
		const isInput = blob => blob instanceof File && blob.name.endsWith('.aiff') || ranges.has(blob);
		window.aiffMetadataPayloadBytes = 0;
		Blob.prototype.slice = function (start, end, type) {
			const range = slice.call(this, start, end, type);
			if (isInput(this)) ranges.add(range);
			return range;
		};
		Blob.prototype.arrayBuffer = function () {
			if (isInput(this) && this.size >= 32 * 1024) window.aiffMetadataPayloadBytes += this.size;
			return arrayBuffer.call(this);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles(join(directory, `${count}.aiff`));
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const download = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await download));
	const project = JSON.parse(strFromU8(files['project.json']));
	const source = project.sources[0], contribution = source.provenance.contributions[0];
	expect(contribution.metadata.normalized.title).toBe('Retained title');
	expect(contribution.warnings.some(warning => warning.includes('aggregate'))).toBe(count === 513);
	expect(await page.evaluate(() => window.aiffMetadataPayloadBytes)).toBeLessThanOrEqual(17 * 1024 * 1024);
	expect(source).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
	const pcm = Buffer.from(Object.entries(files).find(([name]) => name.endsWith('.f32c'))[1]);
	expect(pcm.readUInt32LE(0)).toBe(4800);
	for (let index = 0; index < 4800; index++) expect(pcm.readFloatLE(4 + index * 4)).toBe(.25);
});
