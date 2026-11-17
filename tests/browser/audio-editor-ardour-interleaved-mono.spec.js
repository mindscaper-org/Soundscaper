/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { ardourInterleavedMonoSession } from '../helpers/ardour-interleaved-mono-fixture.ts';

test('Ardour mono and stereo regions retain separate channel views of one WAV', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const wave = encodeWav([new Float32Array(4800).fill(.125), new Float32Array(4800).fill(.375)], { sampleRate: 48000, float: true });
	await importFiles(editor, [{ name: 'Channels.ardour', mimeType: 'application/xml', buffer: Buffer.from(ardourInterleavedMonoSession(true)) },
		{ name: 'stereo.wav', mimeType: 'audio/wav', buffer: Buffer.from(wave) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor);
	expect(pcm[1000]).toBeCloseTo(.625, 4);
});
