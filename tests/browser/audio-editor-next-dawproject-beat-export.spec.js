/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, chooseNestedCommandAction,
	importFiles, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { rewriteScapeProjectDocument } from '../helpers/scape-archive-rewrite.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('a native musical fader keeps its audible slope through DAWproject export and reopen', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Constant.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(96_000).fill(0.25)], { sampleRate: 48_000, float: true })) }]);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const native = await rewriteScapeProjectDocument(new Blob([await downloadBytes(await saving)]), project => {
		const track = project.tracks.find(track => track.type === 'audio' && track.clipIds.length > 0);
		expect(track).toBeTruthy();
		Object.assign(project, createSoundscaperProject({ ...project, id: 'native-musical-ramp',
			tempoMap: { mode: 'musical', events: [{ id: 'root', beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
				{ id: 'faster', beat: { num: 1, den: 1 }, bpm: { num: 120, den: 1 } }] },
			automationLanes: [{ id: 'musical-gain', address: { kind: 'strip', strip: { kind: 'track', id: track.id }, parameterId: 'gain' },
				timebase: 'musical-beats', points: [{ id: 'a', position: { num: 0, den: 1 }, value: 0.2 },
					{ id: 'b', position: { num: 2, den: 1 }, value: 1 }], segments: [{ kind: 'linear' }] }],
		}));
	});
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Musical.sscape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: Buffer.from(await native.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'native-musical-ramp');
	const before = await exportSamples(page, editor);
	expect(before[48_000] / before[4_800]).toBeCloseTo(2.5, 2);
	const exporting = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const bytes = await downloadBytes(await exporting);
	const reopening = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await reopening).setFiles({ name: 'Roundtrip.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(before.length);
	expect(after[48_000] / before[48_000]).toBeCloseTo(1, 3);
});
