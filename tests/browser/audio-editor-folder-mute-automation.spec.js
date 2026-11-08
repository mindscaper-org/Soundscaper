/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { normalizeAutomationLaneV21 } from '../../src/common/editor/automation-lane-v21.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function input(mode) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const project = createSoundscaperProject({ id: `mute-lane-${mode}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Programme', sourceId: source.id, durationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Programme', clipIds: ['clip'], mute: mode === 'leaf' })],
		automationLanes: mode === 'none' ? [] : [normalizeAutomationLaneV21({ id: 'mute-lane',
			address: { kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'mute' },
			timebase: 'absolute-samples', points: [{ id: 'off', position: 0, value: 0 }], segments: [] })],
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 48_000 }, (_, frame) => .1 * Math.sin(2 * Math.PI * 440 * frame / 48_000))]);
		await writer.commit();
		return { project, bytes: Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer()) };
	} finally { await store.close(); }
}

function peak(samples) {
	return samples.slice(9_600, 38_400).reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
}

for (const mode of ['none', 'leaf', 'folder']) test(`folder mute composes with local automation (${mode})`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/'), fixture = await input(mode);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Mute.sscape', mimeType: 'application/zip', buffer: fixture.bytes });
	await expect(editor).toHaveAttribute('data-project-id', fixture.project.id); await waitForProjectActivation(editor);
	expect(peak(await exportSamples(page, editor))).toBeGreaterThan(.06);
	if (mode === 'leaf') return; // Its own lane legitimately opens a locally muted track.
	const clip = clipByName(editor, 'Programme'); await clip.locator('.clip-header').click();
	const row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Move selection into new folder');
	const folder = editor.locator('[data-track-folder-row]'); await expect(folder).toHaveCount(1);
	await folder.getByRole('button', { name: 'Mute folder', exact: true }).click();
	expect(peak(await exportSamples(page, editor))).toBeLessThan(.00001);
	const mute = folder.getByRole('button', { name: 'Mute folder', exact: true });
	await expect(mute).toHaveAttribute('aria-pressed', 'true'); await mute.click();
	await expect(mute).toHaveAttribute('aria-pressed', 'false');
	expect(peak(await exportSamples(page, editor))).toBeGreaterThan(.06);
});
