/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { captureAudacityNoiseProfile } from '../../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../../src/common/editor/pffft.js';
import { createEffect } from '../../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

await initializePffft();

for (const listening of ['pan', 'vca', 'output', 'bypass']) {
	test(`Master Get noise profile reads native rack input before listening ${listening}`, async ({ page }) => {
		const source = createAudioSource({ id: 'tone', frameCount: 4096, sampleRate: 48_000, channelCount: 2 });
		const channels = [Float32Array.from({ length: 4096 }, (_, frame) => .25 * Math.sin(frame / 8)),
			Float32Array.from({ length: 4096 }, (_, frame) => -.25 * Math.sin(frame / 8))];
		const noise = createEffect('audacity-noise-reduction', { id: 'reduction', enabled: false });
		const base = createSoundscaperProject({ id: `noise-input-${listening}`, sources: [source],
			tracks: [createAudioTrack({ id: 'track', name: 'Recording', clipIds: ['clip'] })],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })] });
		const vcas = [{ id: 'listening', name: 'Listening', gain: listening === 'vca' ? .25 : 1, mute: listening === 'vca', members: [{ kind: 'master' }] },
			{ id: 'programme', name: 'Programme', gain: .5, mute: false, members: [{ kind: 'track', id: 'track' }] }];
		const project = createSoundscaperProject({ ...base,
			master: { ...base.master, pan: listening === 'pan' ? 1 : 0, effects: [noise] }, mixer: { ...base.mixer, vcas, edges: [
				...base.mixer.edges.map(edge => listening === 'output' && edge.source.kind === 'master' && edge.destination.kind === 'output' ? { ...edge, level: 0 } : edge),
				...(listening === 'bypass' ? [{ id: 'bypass', kind: 'assignment', source: { kind: 'track', id: 'track' }, destination: { kind: 'output', id: base.mixer.outputs.find(output => output.role === 'main').id },
					position: 'post-fader', enabled: true, level: 1, channelMap: [0, 1] }] : [])] } });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
		let blob;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write(channels); await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
		} finally { await store.close(); }
		const expected = captureAudacityNoiseProfile(channels.map(channel => channel.map(sample => sample * .5)), 48_000);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Rack input.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
		const master = editor.locator('.kw-audio-editor__mixer-channel--master');
		await master.getByRole('button', { name: 'Select effect', exact: true }).first().click();
		const slot = editor.locator('[data-workspace-panel="effects"]').getByRole('group', { name: 'Noise Reduction', exact: true });
		await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
		await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saved = await persistedProject(page, project.id);
		const profile = saved.master.effects.find(effect => effect.id === noise.id).context.noiseProfile;
		expect(profile.meanPowers).toHaveLength(expected.meanPowers.length);
		const peak = Math.max(...expected.meanPowers);
		const peakBin = expected.meanPowers.indexOf(peak);
		expect(profile.meanPowers[peakBin]).toBeCloseTo(peak, 3);
		for (const [bin, power] of profile.meanPowers.entries()) expect(Math.abs(power - expected.meanPowers[bin])).toBeLessThan(Math.max(.000001, expected.meanPowers[bin] * .00002));
		expect(saved.mixer.vcas).toEqual(vcas);
		expect(saved.master.pan).toBe(project.master.pan);
	});
}
