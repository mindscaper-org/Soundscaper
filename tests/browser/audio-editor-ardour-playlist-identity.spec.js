/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { ardourPlaylistIdentitySession } from '../helpers/ardour-playlist-identity-fixture.ts';

test('Ardour active playlist ID remains unambiguous beside a numeric playlist name', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const channel = new Float32Array(4800); channel.fill(.125, 0, 2400); channel.fill(.375, 2400);
	await importFiles(editor, [{ name: 'Playlist.ardour', mimeType: 'application/xml', buffer: Buffer.from(ardourPlaylistIdentitySession(false)) },
		{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([channel], { sampleRate: 48000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor, { includeTail: false });
	expect(pcm[1200]).toBeCloseTo(.125 / Math.sqrt(2), 4);
});
