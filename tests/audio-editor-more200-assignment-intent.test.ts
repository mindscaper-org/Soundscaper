/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { renderStoredProject, writeProjectPcm } from './helpers/native-render-custody.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';

for (const custom of [false, true]) for (const level of [1, .4]) test(`ordinary selection preserves the authored direct assignment (custom=${String(custom)}, level=${String(level)})`, () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: base.mixer.edges.map(edge => edge.source.kind === 'track'
		? { ...edge, id: custom ? 'reviewed-voice-output' : edge.id, level } : edge) } });
	const selected = applySoundscaperProjectCommand(project, { type: 'selection/set', startFrame: 0, endFrame: 4800, trackIds: ['voice'], clipIds: ['clip'] });
	assert.deepEqual(selected.mixer.edges, project.mixer.edges);
	assert.deepEqual(project.selection.clipIds, []);
});

test('selection retains an authored send-only programme path without restoring a dry master path', () => {
	const base = createSoundscaperProject({ tracks: [createAudioTrack({ id: 'voice', clipIds: [] })] });
	const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, sends: [send], edges: [
		...base.mixer.edges.map(edge => edge.source.kind === 'track' ? { ...edge, id: 'wet-only', kind: 'send', level: .4,
			destination: { kind: 'mixer-node', id: send.id } } : edge),
		{ id: 'wet-output', kind: 'assignment', source: { kind: 'mixer-node', id: send.id }, destination: { kind: 'master' },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
	] } });
	const selected = applySoundscaperProjectCommand(project, { type: 'selection/set', startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: [] });
	assert.deepEqual(selected.mixer.edges, project.mixer.edges);
});

for (const custom of [false, true, 'send-only'] as const) for (const channelCount of [1, 2]) {
	test(`native ${channelCount}-channel assignment ${custom} preserves independent PCM through selection, print and Scape reopening`, async context => {
		const source = createAudioSource({ id: 'source', name: 'Original.wav', sampleRate: 48_000, frameCount: 4800, channelCount });
		const base = createSoundscaperProject({ id: context.name, sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
		const sendOnly = custom === 'send-only';
		const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
		const edges = base.mixer.edges.map(edge => edge.source.kind === 'track' ? { ...edge,
			id: custom ? 'reviewed-voice-output' : edge.id, level: .4,
			...(sendOnly ? { kind: 'send', destination: { kind: 'mixer-node', id: send.id } } : {}) } : edge);
		if (sendOnly) edges.push({ id: 'wet-output', kind: 'assignment', source: { kind: 'mixer-node', id: send.id }, destination: { kind: 'master' },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] });
		const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, sends: sendOnly ? [send] : [], edges } });
		const native = createNodeWebAudioEngineFactory(context);
		const { controller, store } = await controllerSession(context, { engine: native.createEngine(), engineFactory: native.createEngine });
		try {
			await writeProjectPcm(store, project, new Map([[source.id,
				Array.from({ length: channelCount }, (_, channel) => new Float32Array(4800).fill(channel ? -.125 : .25))]]));
			await controller.actions.project.open(project);
			await assertProgramme();
			controller.actions.timeline.selectClip('clip');
			assert.deepEqual(clipboardProject(controller.project).mixer.edges, project.mixer.edges);
			await assertProgramme();
			const printed = await controller.actions.track.mixAndRender({ mixDown: true, renderEffects: true, replaceOriginals: true }); assert.ok(printed);
			assert.ok(!clipboardProject(controller.project).clips.some(clip => clip.id === 'clip'));
			await assertProgramme(); await controller.actions.project.flush();
			await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
				assert.equal(channels.length, name === 'Original.wav' ? channelCount : 2);
				for (const [channel, samples] of channels.entries()) {
					assert.equal(samples.length, 4800);
					const expected = name === 'Original.wav' ? channel ? -.125 : .25 : programme(channel);
					for (let frame = 256; frame < 4544; frame++) assert.ok(Math.abs(samples[frame]! - expected) < 1e-6);
				}
			});
		} finally { await controller.dispose(); await native.dispose(); }

		function programme(channel: number): number { return channelCount === 1 ? .25 * .4 * Math.SQRT1_2 : (channel ? -.125 : .25) * .4; }
		async function assertProgramme(): Promise<void> {
			const output = await renderStoredProject(native, store, clipboardProject(controller.project), 4800);
			assert.equal(output.numberOfChannels, 2);
			for (let channel = 0; channel < 2; channel++) for (let frame = 256; frame < 4544; frame++)
				assert.ok(Math.abs(output.getChannelData(channel)[frame]! - programme(channel)) < 1e-6, `channel ${channel}, frame ${frame}`);
		}
	});
}
