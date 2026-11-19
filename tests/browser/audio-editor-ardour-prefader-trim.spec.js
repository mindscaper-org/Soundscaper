/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { ardourPrefaderTrimSession } from '../helpers/ardour-prefader-trim-fixture.ts';

test('Ardour import composes automated input trim and a pre-fader cue', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Trimmed cue.ardour', mimeType: 'application/xml', buffer: Buffer.from(ardourPrefaderTrimSession(true, true)) },
		{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor);
	for (const frame of [12000, 24000, 36000]) {
		const gain = .5 + .5 * frame / 48000;
		expect(pcm[frame]).toBeCloseTo(.25 * gain * gain, 4);
	}
});
