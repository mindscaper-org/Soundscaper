/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { reaperSoloDefeatSession } from '../helpers/reaper-solo-defeat-fixture.ts';

test('REAPER import retains programme audio protected by solo defeat', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Solo-defeat.rpp', mimeType: 'text/plain', buffer: Buffer.from(reaperSoloDefeatSession(true, true, false)) },
		{ name: 'programme.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor);
	expect(pcm.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)).toBeCloseTo(.25, 3);
});
