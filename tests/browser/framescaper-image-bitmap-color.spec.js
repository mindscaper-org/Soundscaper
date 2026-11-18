/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

function windowsColorBitmap(headerLength) {
	const pixelOffset = 14 + headerLength;
	const bytes = Buffer.alloc(pixelOffset + 4);
	bytes.write('BM', 0, 'ascii');
	bytes.writeUInt32LE(bytes.length, 2);
	bytes.writeUInt32LE(pixelOffset, 10);
	bytes.writeUInt32LE(headerLength, 14);
	bytes.writeInt32LE(1, 18);
	bytes.writeInt32LE(1, 22);
	bytes.writeUInt16LE(1, 26);
	bytes.writeUInt16LE(24, 28);
	bytes.writeUInt32LE(4, 34);
	bytes.writeUInt32LE(0x57696e20, 70); // LCS_WINDOWS_COLOR_SPACE
	if (headerLength === 124) bytes.writeUInt32LE(4, 122); // LCS_GM_IMAGES
	bytes.set([41, 103, 229, 0], pixelOffset);
	return bytes;
}

test('Windows default sRGB bitmaps import with their original pixel colors', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	const files = [108, 124].map((length, index) => ({ name: `windows-v${index + 4}.bmp`, mimeType: 'image/bmp', buffer: windowsColorBitmap(length) }));
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles(files);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await saving;
	let entries;
	try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const project = JSON.parse(strFromU8(entries['project.json']));
	const manifest = JSON.parse(strFromU8(entries['manifest.json']));
	for (const file of files) {
		const source = project.sources.find(candidate => candidate.original?.fileName === file.name);
		const body = entries[manifest.assets.find(asset => asset.sourceId === `framescaper:image:${source.id}`).entry];
		const reader = await openFramescaperImageFramePackV1({ source, read: (offset, length) => body.slice(offset, offset + length) });
		expect([...await reader.readFrame(0)]).toEqual([229, 103, 41, 255]);
		expect(Buffer.from(await reader.readOriginal())).toEqual(file.buffer);
	}
});
