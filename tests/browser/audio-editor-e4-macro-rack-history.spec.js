/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const [gainDb, cropped] of [[0, false], [6, false], [6, true]]) test(`an offline ${gainDb}dB macro preserves later delay history, cropped source ${cropped}`, async ({ page }) => {
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `macro-history-${gainDb}-${cropped}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: cropped ? 48_000 : 0,
			sourceStartFrame: cropped ? 48_000 : 0, durationFrames: cropped ? 48_000 : 96_000, sourceDurationFrames: cropped ? 48_000 : 96_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let start = 0; start < 96_000; start += 65_536) await writer.write([Float32Array.from({ length: Math.min(65_536, 96_000 - start) }, (_, index) => {
			const frame = start + index;
			return frame >= 43_200 && frame < 43_680 || frame >= 67_200 && frame < 67_680 ? .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000) : 0;
		})]);
		await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const errors = collectClientErrors(page); await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Recording.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const original = await exportSamples(page, editor);
	async function run(prefix) {
		await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
		const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
		await manager.getByLabel('New program', { exact: true }).click();
		await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(`await sound.select.frames(48000,96000); await sound.effects([${prefix}{type:'delay',params:{time:.2,feedback:0,mix:1}}]);`);
		await manager.getByRole('button', { name: 'Run program', exact: true }).click();
		await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout: 15_000 });
		await manager.getByRole('button', { name: 'Close', exact: true }).click();
		return exportSamples(page, editor);
	}
	const direct = await run(''); await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const actual = await run(`{type:'audacity-amplify',params:{gainDb:${gainDb}}},`);
	const peak = (samples, start) => Math.max(...samples.slice(start, start + 2000).map(Math.abs));
	expect(peak(direct, 52_000)).toBeCloseTo(cropped ? 0 : .25 * Math.SQRT1_2, 5);
	expect(peak(direct, 76_000)).toBeGreaterThan(.1);
	const expected = direct.map((sample, frame) => frame >= 76_800 && frame < 77_280 ? sample * 10 ** (gainDb / 20) : sample);
	const error = samples => samples.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - expected[frame])), 0);
	expect(actual).toHaveLength(direct.length); expect(error(actual)).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportSamples(page, editor);
	expect(undone).toHaveLength(original.length);
	expect(undone.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - original[frame])), 0)).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); expect(error(await exportSamples(page, editor))).toBeLessThan(.0001);
	expect(errors).toEqual([]);
});
