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
import { evaluateAutomationLaneAtFrameV21 as evaluate } from '../../src/common/editor/automation-lane-v21.ts';

for (const gesture of [false, true]) test(`Touch preserves the programme outside capture, gesture=${gesture}`, async ({ page }) => {
	const { project, blob } = await projectArchive(gesture);
	const original = project.automationLanes[0];
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Touch.sscape', mimeType: 'application/zip',
		buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor);
	const row = editor.locator('[data-track-row][data-track-id="voice"]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	await row.getByRole('combobox', { name: 'Automation mode' }).selectOption('touch');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(24_000);
	if (gesture) await touchVolume(page, row, playhead);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
	const readLane = async () => (await persistedProject(page, project.id)).automationLanes[0];
	const lane = await readLane();
	if (gesture) {
		const capture = lane.points.filter(point => point.id.startsWith('automation-capture-'));
		expect(capture.length).toBeGreaterThan(1);
		expect(capture[0].position).toBeGreaterThan(18_000);
		expect(capture.at(-1).position).toBeLessThan(180_000);
		expect(capture.at(-1).value).toBeLessThan(.5);
	}
	const after = await exportSamples(page, editor);
	for (const frame of [12_000, 180_000]) expect(evaluate(lane, frame, { sampleRate: 48_000 }))
		.toBeCloseTo(evaluate(original, frame, { sampleRate: 48_000 }), 8);
	for (const [start, end] of [[12_000, 18_000], [180_000, 186_000]]) {
		const error = Math.max(...after.slice(start, end).map((value, i) => Math.abs(value - before[start + i])));
		// Two independently subdivided curves each allow 1e-4 gain error. At
		// .25 mono/equal-power stereo this plus 24-bit quantization is <4e-5 PCM.
		expect(error).toBeLessThan(.00004);
	}
	if (gesture) {
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.poll(readLane).toEqual(original);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect.poll(readLane).toEqual(lane);
	}
	expect(errors).toEqual([]);
});

async function touchVolume(page, row, playhead) {
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const bounds = await volume.boundingBox(); expect(bounds).not.toBeNull();
	const value = Number(await volume.inputValue());
	const minimum = Number(await volume.getAttribute('min')), maximum = Number(await volume.getAttribute('max'));
	const x = bounds.x + bounds.width * (value - minimum) / (maximum - minimum), y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(Math.max(bounds.x + 3, x - bounds.width * .25), y, { steps: 4 });
	const start = Number(await playhead.getAttribute('aria-valuenow'));
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(start + 4_800);
	await page.mouse.up();
}

async function projectArchive(gesture) {
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 192_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `touch-boundaries-${gesture}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: source.frameCount, durationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		automationLanes: [{ id: 'voice-gain', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'a', position: 0, value: 1 }, { id: 'b', position: 192_000, value: .2 }],
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
