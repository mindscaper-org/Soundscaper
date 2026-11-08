/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseCartPayload } from '../../src/common/editor/cart-metadata.ts';
import { readRiffChunks } from '../helpers/read-riff-chunks.ts';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';
import {
	bootEditor, chooseDropdown, clipByName, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

// Individual namespace combinations are covered through import, Scape reopen
// and BWF planning in audio-editor-broadcast-import-custody.test.ts.
test('broadcast WAV import and delivery retain BEXT, CART and iXML in their own chunks', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const name = 'studio-take.wav';
	const buffer = encodeWav([new Float32Array(48_000).fill(.125)], {
		sampleRate: 48_000, bitDepth: 16, dither: false,
		bext: { description: 'Recorder description' },
		cart: { title: 'Radio continuity take', postTimers: [{ usage: 'SEC1', value: 24_000 }] },
		ixml: { project: 'Radio series', scene: 'Studio A', take: '12', note: 'Keep the complete take.' },
	});
	await importFiles(editor, [{ name, mimeType: 'audio/wav', buffer: Buffer.from(buffer) }]);
	await expect(clipByName(editor, name)).toBeVisible({ timeout: 20_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const chunks = readRiffChunks(bytes);
	const cart = parseCartPayload(chunks.get('cart'));
	expect(cart.title).toBe('Radio continuity take');
	expect(cart.postTimers).toEqual([{ usage: 'SEC1', value: 24_000 }]);
	expect(new TextDecoder().decode(chunks.get('bext').subarray(0, 256))).toContain('Recorder description');
	const xml = new TextDecoder().decode(chunks.get('iXML'));
	for (const field of ['<PROJECT>Radio series</PROJECT>', '<SCENE>Studio A</SCENE>', '<TAKE>12</TAKE>',
		'<NOTE>Keep the complete take.</NOTE>']) expect(xml).toContain(field);
	const pcm = readWavePcm(bytes);
	expect(pcm.sampleRate).toBe(48_000); expect(pcm.channels).toHaveLength(2);
	expect(pcm.channels[0]).toHaveLength(48_000);
	expect(pcm.channels[0][2000]).toBeCloseTo(.125 * Math.SQRT1_2, 4);
});
