/* SPDX-License-Identifier: AGPL-3.0-only */
import { writeFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { chainedOpusFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

test('File Import and project export retain both links of the radio recording', async ({ page }, testInfo) => {
	const fixture = await chainedOpusFixture();
	const media = [
		{ name: 'First.opus', bytes: fixture.first, frameCount: 48_001 },
		{ name: 'Second.opus', bytes: fixture.chained.subarray(fixture.first.length), frameCount: 24_001 },
		{ name: 'Radio.opus', bytes: fixture.chained, frameCount: fixture.frames },
	];
	const paths = await Promise.all(media.map(async ({ name, bytes }) => {
		const path = testInfo.outputPath(name);
		await writeFile(path, bytes);
		return path;
	}));
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const picking = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await picking).setFiles(paths);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	const saving = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving));
	const project = JSON.parse(strFromU8(entries['project.json']));
	const [first, second, chain] = media.map(({ name, frameCount }) => {
		const source = project.sources.find(candidate => candidate.name === name);
		expect(source).toMatchObject({ channelCount: 1, sampleRate: 48_000, frameCount });
		const bytes = Buffer.from(entries[`audio/${source.id}.f32c`]);
		const chunks = [];
		for (let offset = 0; offset < bytes.length;) {
			const end = offset + 4 + bytes.readUInt32LE(offset) * 4;
			chunks.push(bytes.subarray(offset + 4, end));
			offset = end;
		}
		return Buffer.concat(chunks);
	});
	expect(chain).toEqual(Buffer.concat([first, second]));
});
