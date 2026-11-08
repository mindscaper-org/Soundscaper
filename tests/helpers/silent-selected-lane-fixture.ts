/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createEffectSelectionService } from '../../src/common/editor/controller/effects/effect-selection-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioEditorProjectV17 } from '../../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { audacitySelectionChannelCount } from '../../src/common/editor/audacity-selection.js';

export function silentSelectedLaneFixture() {
	const rate = 8000;
	const authored = createAudioEditorProjectV17({ sampleRate: rate,
		sources: [createAudioSource({ id: 'source', frameCount: rate, sampleRate: rate, channelCount: 1 })],
		tracks: ['first', 'later'].map(id => ({ ...createAudioTrack({ id, clipIds: [`clip-${id}`] }, rate) })),
		clips: ['first', 'later'].map((id, index) => ({ ...createAudioClip({ id: `clip-${id}`, sourceId: 'source',
			timelineStartFrame: index * 3 * rate, durationFrames: rate, sourceDurationFrames: rate }) })),
		selection: { startFrame: 0, endFrame: rate, trackIds: ['first', 'later'], clipIds: [], frequencyRange: null },
	});
	const project = { ...authored, tracks: authored.tracks.map(track => ({ ...track })), clips: authored.clips.map(clip => {
		assert.ok(clip.kind === 'audio'); return { ...clip, timelineStartFrame: Number(clip.timelineStartFrame), durationFrames: Number(clip.durationFrames) };
	}) };
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const state = { selectedTrackId: 'first', selectedClipId: null, audacityEffectType: 'multi-tap-delay', audacityEffectProcessing: false,
		audacityEffectTouchedParams: new Map<string, Set<string>>(), audacityPreviewGeneration: 0 };
	const copy = { audioTrackRequired: 'Audio required', maximumFrequency: 'Maximum', minimumFrequency: 'Minimum',
		parameterRangeError: 'Range error', spectralEffectLengthChanging: 'Cannot change spectral length', timeSelectionRequired: 'Select time',
		v2Required: 'Current version required', audacityProcessing: 'Processing', audacityApplied: 'Applied' };
	const selection = createEffectSelectionService({ state, copy, getProject: () => project,
		activeSelection: () => project.selection, resolveEditingSelection: () => null,
		audacitySelectionChannelCount, audioTrackChannelCount: () => 1, selectedTracksTimeRange: () => project.selection,
		projectSampleRate: () => rate, editingBlocked: () => false,
		setSelection: (startFrame, endFrame, details) => ({ selection: { startFrame, endFrame, ...details } }),
	});
	return { rate, project, lifetime, generation, state, copy, selection };
}
