/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, disableNativeSavePicker,
	waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';


for (const beforePlay of [true, false]) test(`Write captures the running programme when selected ${beforePlay ? 'before' : 'during'} Play`, async ({ page }) => {
	const { project, blob } = await projectArchive(beforePlay);
	const original = project.automationLanes[0], errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Write.sscape', mimeType: 'application/zip',
		buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor);
	const row = editor.locator('[data-track-row][data-track-id="voice"]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const mode = row.getByRole('combobox', { name: 'Automation mode' });
	if (beforePlay) await mode.selectOption('write');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(24_000);
	if (!beforePlay) await mode.selectOption('write');
	await expect(mode).toHaveValue('write');
	const started = Number(await playhead.getAttribute('aria-valuenow'));
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(started + 4_800);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
	const readLane = async () => (await persistedProject(page, project.id)).automationLanes[0];
	const lane = await readLane(), after = await exportSamples(page, editor);
	const capture = lane.points.filter(point => point.id.startsWith('automation-capture-'));
	expect(capture.length).toBeGreaterThan(1);
	expect(capture.at(-1).position).toBeGreaterThan(capture[0].position);
	if (!beforePlay) expect(capture[0].position).toBeGreaterThan(24_000);
	// The displayed playhead can lag the native capture clock. Inspect a sample
	// inside the actual stored capture, whose exact start is tested at domain level.
	const frame = Math.floor((capture[0].position + capture.at(-1).position) / 2);
	// The static strip gain is 1, the original lane is .2, and the raw mono PCM
	// is .25. Write must replace the lane with the held control, without a gesture.
	expect(before[frame]).toBeCloseTo(.25 * Math.SQRT1_2 * .2, 6);
	expect(Math.abs(after[frame] - before[frame] * 5)).toBeLessThan(.00001);
	if (!beforePlay) expect(Math.abs(after[12_000] - before[12_000])).toBeLessThan(.00001);
	expect(Math.abs(after[180_000] - before[180_000])).toBeLessThan(.00001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(readLane).toEqual(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(readLane).toEqual(lane);
	expect(errors).toEqual([]);
});

async function projectArchive(beforePlay) {
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 192_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `write-arm-${beforePlay}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: source.frameCount, durationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		automationLanes: [{ id: 'voice-gain', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'a', position: 0, value: .2 }, { id: 'b', position: 192_000, value: .2 }],
			segments: [{ kind: 'eased' }] }] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let frame = 0; frame < source.frameCount; frame += source.chunkFrames) await writer.write([
			new Float32Array(Math.min(source.chunkFrames, source.frameCount - frame)).fill(.25),
		]);
		await writer.commit(); const { blob } = await exportScapeProject(project, store); expect(blob).toBeTruthy();
		return { project, blob };
	} finally { await store.close(); }
}
