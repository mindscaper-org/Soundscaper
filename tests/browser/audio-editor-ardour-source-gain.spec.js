/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { ardourNormalizedFlacFiles, ardourSourceGainSession } from '../helpers/ardour-source-gain-fixture.ts';

for (const layout of ['mono', 'split', 'interleaved']) test(`Ardour archived ${layout} FLAC restores original source levels`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Archived.ardour', mimeType: 'application/xml', buffer: Buffer.from(ardourSourceGainSession(layout, [.25, .5])) },
		...(await ardourNormalizedFlacFiles(layout)).map(file => ({ name: file.name, mimeType: 'audio/flac', buffer: Buffer.from(file.bytes) }))]);
	await expect(editor).toHaveAttribute('data-clip-count', layout === 'mono' ? '1' : '2');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const pcm = await exportSamples(page, editor, { includeTail: false });
	expect(pcm[1200]).toBeCloseTo(.0625 * (layout === 'mono' ? Math.SQRT1_2 : 1), 4);
});
