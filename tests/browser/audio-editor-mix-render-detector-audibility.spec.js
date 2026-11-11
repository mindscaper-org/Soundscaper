/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function input(position, mode) {
	const sampleRate = 48_000, length = sampleRate * 2;
	const sources = ['programme', 'key'].map(id => createAudioSource({ id, storageKey: id, name: id,
		sampleRate, channelCount: 1, frameCount: length }));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
		title: source.name, durationFrames: length, sourceDurationFrames: length }));
	let project = createSoundscaperProject({ id: `print-key-${position}-${mode}`, sampleRate, sources, clips,
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.name, clipIds: [`${source.id}-clip`],
			...(source.id === 'programme' ? { effectsActive: true, effects: [createEffect('gate', { id: 'gate',
				params: { threshold: -30, attack: 0, hold: .1, release: .01, rangeDb: -80 } })] }
				: { mute: mode === 'leaf' }),
		})), selection: { startFrame: 0, endFrame: length, trackIds: ['programme'], clipIds: ['programme-clip'] } });
	const bus = mode === 'bus';
	project = createSoundscaperProject({ ...project, mixer: { ...project.mixer,
		groups: bus ? [{ id: 'key-bus', name: 'Key bus', color: '#808080', channelCount: 2, gain: .5,
			pan: 0, mute: true, solo: false, collapsed: false, effectsActive: true, effects: [] }] : [],
		vcas: mode === 'vca-mute' || mode === 'vca-gain' ? [{ id: 'key-vca', name: 'Key VCA', gain: .5,
			mute: mode === 'vca-mute', members: mode === 'vca-mute' ? [{ kind: 'track', id: 'key' }]
				: [{ kind: 'track', id: 'programme' }, { kind: 'track', id: 'key' }] }] : [],
		edges: [...project.mixer.edges.map(edge => bus && edge.source.kind === 'track' && edge.source.id === 'key'
			? { ...edge, destination: { kind: 'mixer-node', id: 'key-bus' } } : edge),
			...(bus ? [{ id: 'key-bus-output', kind: 'assignment', source: { kind: 'mixer-node', id: 'key-bus' },
				destination: { kind: 'master' }, position: 'post-fader', enabled: true, level: 1, channelMap: [0, 1] }] : []),
			{ id: 'key-feed', kind: 'sidechain', source: bus ? { kind: 'mixer-node', id: 'key-bus' } : { kind: 'track', id: 'key' },
				destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
				position, enabled: true, level: 1, channelMap: [0] }],
	} });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			const amplitude = source.id === 'programme' ? .1 : .5, frequency = source.id === 'programme' ? 440 : 880;
			for (let offset = 0; offset < length; offset += source.chunkFrames) await writer.write([
				Float32Array.from({ length: Math.min(source.chunkFrames, length - offset) },
					(_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * (offset + frame) / sampleRate)),
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
		sine += samples[frame] * Math.sin(phase); cosine += samples[frame] * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / 67_200;
}

for (const [mixDown, position, mode] of [
	[true, 'pre-fader', 'leaf'], [false, 'post-fader', 'leaf'],
	[true, 'post-fader', 'vca-mute'], [true, 'post-fader', 'vca-gain'], [true, 'post-fader', 'bus'],
]) test(`${mixDown ? 'Combined' : 'Individual'} Mix & Render retains the ${position} ${mode} detector`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const fixture = await input(position, mode);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'key.sscape', mimeType: 'application/zip', buffer: fixture.bytes });
	await expect(editor).toHaveAttribute('data-project-id', fixture.project.id); await waitForProjectActivation(editor);
	await clipByName(editor, 'programme').locator('.clip-header').click();
	const before = programmeAmplitude(await exportSamples(page, editor));
	if (position === 'pre-fader' || mode === 'vca-gain') expect(before).toBeGreaterThan(.03);
	else expect(before).toBeLessThan(.00001);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	if (!mixDown) await dialog.getByRole('checkbox', { name: 'Mix down', exact: true }).uncheck();
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click(); await expect(dialog).toBeHidden();
	const after = programmeAmplitude(await exportSamples(page, editor));
	expect(Math.abs(after - before)).toBeLessThan(.0001);
});
