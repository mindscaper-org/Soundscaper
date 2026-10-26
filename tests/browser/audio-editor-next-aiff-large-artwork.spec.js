/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeAiff } from '../../src/common/editor/aiff.js';
import { createId3Artwork } from '../../src/common/editor/id3-artwork.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('AIFF cover collections retain their text in imported Attribution', async ({ page }) => {
	const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');
	const body = Buffer.alloc(2300 * 1024, 88); body.write('Comment\0');
	const extra = Buffer.alloc(body.length + 12); extra.writeUInt32BE(body.length); extra.write('tEXt', 4); body.copy(extra, 8);
	let crc = 0xffff_ffff;
	for (const byte of extra.subarray(4, -4)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
	}
	extra.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, extra.length - 4);
	const png = Buffer.concat([image.subarray(0, -12), extra, image.subarray(-12)]);
	const front = await createId3Artwork(new File([png], 'Front.png'));
	const back = { ...await createId3Artwork(new File([png], 'Back.png')), pictureType: 4 };
	const bytes = encodeAiff([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, sampleFormat: 'float32',
		metadata: { title: 'Artwork recording', artist: 'Recordist', id3Artwork: JSON.stringify([front, back]) } });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Art.aiff', mimeType: 'audio/aiff', buffer: Buffer.from(bytes) }]);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).click();
	const title = attribution.locator('dl > div').filter({ has: page.getByText('normalized.title', { exact: true }) });
	const artist = attribution.locator('dl > div').filter({ has: page.getByText('normalized.artist', { exact: true }) });
	await expect(title).toContainText('Artwork recording');
	await expect(artist).toContainText('Recordist');
});
