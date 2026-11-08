/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createEffect } from '../../src/common/editor/effects.js';

export type CrossingDetectorMode = 'leaf' | 'folder' | 'vca' | 'none';

export function zeroCrossingDetectorProject(position: 'pre-fader' | 'post-fader', mode: CrossingDetectorMode = 'leaf', targetMuted = false, sharedVca = false) {
	const sampleRate = 48_000, frameCount = 48_000;
	const sources = ['programme', 'key'].map(id => createAudioSource({ id, storageKey: id, name: id,
		sampleRate, channelCount: 1, frameCount }));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
		title: source.name, durationFrames: frameCount, sourceDurationFrames: frameCount }));
	const programme = createAudioTrack({ id: 'programme', name: 'Programme', clipIds: ['programme-clip'], mute: targetMuted,
		effectsActive: true, effects: [createEffect('gate', { id: 'gate',
			params: { threshold: -30, attack: 0, hold: 0, release: .01, rangeDb: -40 } }),
		createEffect('delay', { id: 'echo', params: { time: .1, feedback: 0, mix: .5 } })] });
	const key = createAudioTrack({ id: 'key', name: 'Key', clipIds: ['key-clip'], mute: mode === 'leaf' });
	let authored = createSoundscaperProject({ id: `zero-key-${position}-${mode}`, sampleRate, sources, clips,
		tracks: mode === 'folder' ? [key, programme] : [programme, key],
		...(mode === 'folder' ? { trackFolders: [{ id: 'key-folder', name: 'Key folder', mute: true }],
			primarySequenceId: 'main', sequences: [{ id: 'main', trackNodes: [
				{ kind: 'folder', id: 'key-folder' }, { kind: 'track', id: 'key', parentFolderId: 'key-folder' },
				{ kind: 'track', id: 'programme' },
			] }] } : {}),
	});
	authored = createSoundscaperProject({ ...authored, mixer: { ...authored.mixer,
		vcas: mode === 'vca' ? [{ id: 'shared-vca', name: 'Shared VCA', gain: .5, mute: true,
			members: [...(sharedVca ? [{ kind: 'track' as const, id: 'programme' }] : []), { kind: 'track', id: 'key' }] }] : [],
		edges: [...authored.mixer.edges, ...(mode === 'none' ? [] : [{ id: 'key-feed', kind: 'sidechain' as const,
			source: { kind: 'track' as const, id: 'key' }, destination: { kind: 'effect-sidechain' as const,
				strip: { kind: 'track' as const, id: 'programme' }, effectId: 'gate' },
			position, enabled: true, level: 1, channelMap: [0] }])],
	} });
	return { project: { ...authored, tracks: authored.tracks.map(track => ({ ...track })), clips: authored.clips.map(clip => ({ ...clip })) },
		sources, samples: sources.map(source => Float32Array.from({ length: frameCount }, (_, frame) => source.id === 'key'
			? frame < 9_600 ? .5 * Math.sin(2 * Math.PI * 880 * frame / sampleRate) : 0
			: .25 * Math.sin(2 * Math.PI * 197 * frame / sampleRate))) };
}
