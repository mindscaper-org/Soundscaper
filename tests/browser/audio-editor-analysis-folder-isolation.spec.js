/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, readFile, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function input(mode) {
	const length = 96_000;
	const sources = ['programme', 'peer'].map(id => createAudioSource({
		id, storageKey: id, name: id, sampleRate: 48_000, channelCount: 1, frameCount: length,
	}));
	const project = createSoundscaperProject({ id: `analysis-folder-${mode}`, sources,
		clips: sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
			title: source.id, durationFrames: length, sourceDurationFrames: length })),
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.id, clipIds: [`${source.id}-clip`],
			mute: source.id === 'programme' && mode === 'leaf',
		})),
		selection: { startFrame: 0, endFrame: length, trackIds: ['programme', 'peer'], clipIds: [] },
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			const frequency = source.id === 'programme' ? 440 : 880;
			const amplitude = source.id === 'programme' ? .1 : .5;
			for (let offset = 0; offset < length; offset += source.chunkFrames) await writer.write([
				Float32Array.from({ length: Math.min(source.chunkFrames, length - offset) },
					(_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * (offset + frame) / 48_000)),
			]);
			await writer.commit();
		}
		return { project, bytes: Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer()) };
	} finally { await store.close(); }
}

function programmeAmplitude(samples) {
	let sine = 0, cosine = 0;
	for (let frame = 9_600; frame < 76_800; frame++) {
		const phase = 2 * Math.PI * 440 * frame / 48_000;
		sine += samples[frame] * Math.sin(phase);
		cosine += samples[frame] * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / 67_200;
}

for (const mode of ['leaf', 'folder', 'peer-solo']) test(`Plot spectrum isolates programme across ${mode} audibility`, async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/'), fixture = await input(mode);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'muted.sscape', mimeType: 'application/zip', buffer: fixture.bytes });
	await expect(editor).toHaveAttribute('data-project-id', fixture.project.id);
	await waitForProjectActivation(editor);
	if (mode !== 'leaf') {
		const member = mode === 'folder' ? 'programme' : 'peer';
		await editor.locator(`[data-clip-id="${member}-clip"] .clip-header`).click();
		const row = editor.locator(`[data-track-id="${member}"][data-track-row]`);
		await row.getByRole('button', { name: 'Track menu', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Move selection into new folder', exact: true }).click();
		const folder = editor.locator('[data-track-folder-row]');
		await expect(folder).toHaveCount(1);
		await folder.getByRole('button', { name: mode === 'folder' ? 'Mute folder' : 'Solo folder', exact: true }).click();
		await chooseCommandAction(page, editor, 'Select', 'Select all');
	}
	// Delivery remains authored and muted. Only the isolated analysis overrides audibility.
	expect(programmeAmplitude(await exportSamples(page, editor))).toBeLessThan(.000001);
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(dialog.locator('[data-spectrum-track-id="programme"]')).toHaveCount(1);
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloading;
	const report = JSON.parse(await readFile(await download.path(), 'utf8')).report;
	const programme = report.tracks.find(track => track.trackId === 'programme');
	expect(programme.peak.db).toBeGreaterThan(-25);
	expect(programme.peak.db).toBeLessThan(-21);
	await closeDialog(dialog);
});
