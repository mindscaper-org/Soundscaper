/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { ardourScopedMuteSession } from '../helpers/ardour-scoped-mute-fixture.ts';

for (const { points, post, mutedSample } of [{ points: ['Main', 'PreFader'], post: false, mutedSample: 0 },
	{ points: ['Main'], post: true, mutedSample: .0625 }, { points: ['PreFader'], post: false, mutedSample: .125 }]) {
	test(`Ardour import preserves mute scope ${points.join(',')} with post=${String(post)}`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [{ name: 'Scoped mute.ardour', mimeType: 'application/xml', buffer: Buffer.from(ardourScopedMuteSession(points, false, post, true)) },
			{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(4800).fill(.125), new Float32Array(4800)], { sampleRate: 48000, float: true })) }]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		await waitForProjectActivation(editor);
		const pcm = await exportSamples(page, editor, { includeTail: false });
		expect(pcm[1200]).toBeCloseTo(.1875, 4);
		expect(pcm[3600]).toBeCloseTo(mutedSample, 4);
	});
}
