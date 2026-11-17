/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { soundcraftSession } from '../helpers/native-daw-import-fixtures.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('SoundCraft pre-fader sends stay audible with the main fader down', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const fixture = soundcraftSession();
	const session = { ...fixture, busses: [{ id: 80, name: 'Send input', format: 'Stereo' }], tracks: [
		...fixture.tracks.map(track => ({ ...track, mixer: { volume_db: -144, pan: [0], mute: false, solo: false, output: 'None',
			sends: [{ target: { Bus: 80 }, level_db: 0, pan: 0, mute: false, pre_fader: true }] } })),
		{ id: 30, name: 'Cue return', kind: 'Aux', format: 'Stereo', clips: [], mixer: { volume_db: 0, pan: [-1, 1], mute: false, solo: false,
			input: { Bus: 80 }, output: 'Main' } },
	] };
	await importFiles(editor, [{ name: 'Cue.scraft', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(session)) },
		{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true })) }]);
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const pcm = await exportSamples(page, editor);
	const peak = pcm.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeGreaterThan(.01);
});
