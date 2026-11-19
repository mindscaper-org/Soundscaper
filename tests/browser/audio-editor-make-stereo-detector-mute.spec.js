/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function fixture(keyMuted, pairMuted, position) {
	const sampleRate = 48_000, length = 96_000;
	const sources = ['programme', 'partner', 'key'].map(id => createAudioSource({
		id, storageKey: id, name: id, sampleRate, channelCount: 1, frameCount: length,
	}));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
		title: source.name, durationFrames: length, sourceDurationFrames: length }));
	let project = createSoundscaperProject({ id: `merge-key-${keyMuted}-${pairMuted}-${position}`, sampleRate, sources, clips,
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.name, clipIds: [`${source.id}-clip`],
			mute: source.id === 'key' ? keyMuted : pairMuted,
			...(source.id === 'programme' ? { effectsActive: true, effects: [createEffect('gate', { id: 'gate',
				params: { threshold: -30, attack: 0, hold: .1, release: .01, rangeDb: -80 } })] } : {}),
		})), selection: { startFrame: 0, endFrame: length, trackIds: ['programme'], clipIds: ['programme-clip'] } });
	project = createSoundscaperProject({ ...project, mixer: { ...project.mixer, edges: [...project.mixer.edges,
		{ id: 'key-feed', kind: 'sidechain', source: { kind: 'track', id: 'key' },
			destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
			position, enabled: true, level: 1, channelMap: [0] },
	] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			const frequency = { programme: 440, partner: 660, key: 880 }[source.id];
			for (let offset = 0; offset < length; offset += source.chunkFrames) await writer.write([
				Float32Array.from({ length: Math.min(source.chunkFrames, length - offset) }, (_, frame) => (
					(source.id === 'key' ? .5 : .1) * Math.sin(2 * Math.PI * frequency * (offset + frame) / sampleRate)
				)),
			]);
			await writer.commit();
		}
		return { project, buffer: Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer()) };
	} finally { await store.close(); }
}

function programmeAmplitude(samples) {
	let sine = 0, cosine = 0;
	for (let frame = 9_600; frame < 76_800; frame++) {
		const phase = 2 * Math.PI * 440 * frame / 48_000;
		sine += samples[frame] * Math.sin(phase); cosine += samples[frame] * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / 67_200;
}

for (const [keyMuted, pairMuted, position] of [
	[true, false, 'post-fader'], [false, true, 'post-fader'],
]) test(`Make stereo retains ${position} detector mute=${keyMuted} and selected pair mute=${pairMuted}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/'), input = await fixture(keyMuted, pairMuted, position);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'key.sscape', mimeType: 'application/zip', buffer: input.buffer });
	await expect(editor).toHaveAttribute('data-project-id', input.project.id); await waitForProjectActivation(editor);
	const keySilent = keyMuted && position === 'post-fader';
	const before = programmeAmplitude(await exportSamples(page, editor));
	if (keySilent || pairMuted) expect(before).toBeLessThan(.00002);
	else expect(before).toBeGreaterThan(.03);
	const row = clipByName(editor, 'programme').locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, ['Track channels', 'Make stereo track']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	if (pairMuted) {
		const mute = row.getByRole('button', { name: 'Mute', exact: true });
		await expect(mute).toHaveAttribute('aria-pressed', 'true'); await mute.click();
	}
	const after = programmeAmplitude(await exportSamples(page, editor));
	// An open gate carries .1 amplitude; its authored -80dB closed range carries .00001.
	if (keySilent) expect(after).toBeLessThan(.00002);
	else expect(after).toBeGreaterThan(.03);
});
