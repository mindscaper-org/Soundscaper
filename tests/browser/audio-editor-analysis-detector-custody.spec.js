/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, readFile, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

const SAMPLE_RATE = 48_000;

async function input(position, detector) {
	const length = SAMPLE_RATE * 2;
	const sources = ['programme', 'detector'].map(id => createAudioSource({
		id, storageKey: id, name: id, sampleRate: SAMPLE_RATE, channelCount: 1, frameCount: length,
	}));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
		title: source.name, durationFrames: length, sourceDurationFrames: length }));
	let project = createSoundscaperProject({ id: `analysis-${position}-${detector}`, sampleRate: SAMPLE_RATE, sources, clips,
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.name, clipIds: [`${source.id}-clip`],
			...(source.id === 'programme' ? { effectsActive: true, effects: [createEffect('gate', { id: 'gate',
				params: { threshold: -30, attack: 0, hold: .1, release: .01, rangeDb: -80 } })] } : { mute: detector === 'muted' }),
		})),
		selection: { startFrame: 0, endFrame: length, trackIds: ['programme', 'detector'], clipIds: [] },
	});
	const masterControl = detector === 'master';
	project = createSoundscaperProject({ ...project,
		...(masterControl ? { master: { ...project.master, gain: .001,
			effects: [createEffect('gate', { id: 'master-control-gate' })] } } : {}),
		mixer: { ...project.mixer, edges: [...project.mixer.edges.map(edge => masterControl
			&& edge.source.kind === 'track' && edge.source.id === 'programme'
			? { ...edge, destination: { kind: 'output', id: 'main' } } : edge), {
		id: 'key', kind: 'sidechain', source: masterControl ? { kind: 'master' } : { kind: 'track', id: 'detector' },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
		position, enabled: true, level: 1, channelMap: [0],
	}] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			const amplitude = source.id === 'programme' ? .1 : detector === 'zero' ? 0 : .5;
			const frequency = source.id === 'programme' ? 440 : 880;
			for (let offset = 0; offset < length; offset += source.chunkFrames) await writer.write([
				Float32Array.from({ length: Math.min(source.chunkFrames, length - offset) },
					(_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * (offset + frame) / SAMPLE_RATE)),
			]);
			await writer.commit();
		}
		return { project, bytes: Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer()) };
	} finally { await store.close(); }
}

/** The independent tone component separates the programme from its audible detector. */
function toneAmplitude(samples, frequency) {
	let real = 0, imaginary = 0;
	const start = 9_600, end = Math.min(samples.length, 76_800);
	for (let frame = start; frame < end; frame++) {
		const phase = 2 * Math.PI * frequency * frame / SAMPLE_RATE;
		real += samples[frame] * Math.cos(phase);
		imaginary += samples[frame] * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / (end - start);
}

for (const [position, detector] of [
	['pre-fader', 'tone'], ['post-fader', 'muted'], ['post-fader', 'zero'], ['post-fader', 'master'],
]) test(`Plot spectrum retains its authored ${position} external ${detector} detector`, async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const fixture = await input(position, detector);
	await editor.locator('[data-aup4-input]').setInputFiles({
		name: 'sidechain.sscape', mimeType: 'application/zip', buffer: fixture.bytes,
	});
	await expect(editor).toHaveAttribute('data-project-id', fixture.project.id);
	await waitForProjectActivation(editor);
	const rendered = await exportSamples(page, editor);
	const programmeAmplitude = toneAmplitude(rendered, 440);
	const gated = detector !== 'tone';
	if (gated) expect(programmeAmplitude).toBeLessThan(.00001);
	else {
		expect(programmeAmplitude).toBeGreaterThan(.06);
		expect(programmeAmplitude).toBeLessThan(.08);
	}
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(dialog.locator('[data-spectrum-track-id="programme"]')).toHaveCount(1);
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloading;
	const report = JSON.parse(await readFile(await download.path(), 'utf8')).report;
	const programme = report.tracks.find(track => track.trackId === 'programme');
	expect(programme).toBeTruthy();
	expect(Math.abs(programme.peak.db - 20 * Math.log10(programmeAmplitude))).toBeLessThan(1);
	if (gated) expect(programme.peak.db).toBeLessThan(-100);
	else expect(programme.peak.db).toBeGreaterThan(-25);
	await closeDialog(dialog);
});
