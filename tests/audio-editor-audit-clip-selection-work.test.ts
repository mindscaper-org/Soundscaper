/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory } from '../src/soundscaper/editor-project-history.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createEditorEditService } from '../src/common/editor/controller/edit/internal/edit-service.ts';
import { createSelectionViewService, type SelectionViewServiceRuntime, type SelectionViewState } from '../src/common/editor/controller/track-audio/internal/selection-view-service.ts';
import { createSelectionOwnershipIndex } from '../src/common/editor/controller/track-audio/internal/selection-ownership-index.ts';
import { prepareDuplicateSelectionCommand } from '../src/common/editor/controller/edit/internal/duplicate-selection-command.ts';
import { createClipboardDescriptor } from '../src/common/editor/commands/clipboard-runtime.js';
import { collectRelatedClipIds, resolveEditingSelection } from '../src/common/editor/commands/editing-selection-authority.ts';
import { findClip, findClipTrack, findTrack } from '../src/common/editor/project.js';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';

function fixture() {
	const count = 500;
	const admitted = createSoundscaperProject({ id: 'selection-owner-work',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 64 }],
		clips: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: index * 64 })),
		tracks: [{ id: 'track', clipIds: Array.from({ length: count }, (_, index) => `c${index}`) }],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track'], clipIds: Array.from({ length: count }, (_, index) => `c${index}`) },
	});
	let memberships = 0;
	const tracks = admitted.tracks.map(track => {
		assert.ok(track.type === 'audio');
		return { ...track,
			clipIds: new Proxy(track.clipIds, { get(target, key, receiver) {
				if (typeof key === 'string' && /^\d+$/u.test(key)) memberships++;
				return Reflect.get(target, key, receiver) as unknown;
			} }),
		};
	});
	return { admitted, project: { ...admitted, tracks }, count, get memberships() { return memberships; }, reset() { memberships = 0; } };
}

test('ordinary Copy resolves its selected clip owners with bounded membership work', () => {
	const state = fixture();
	let clipboard: AudioEditorClipboard | null = null;
	const errors: unknown[] = [];
	createEditorEditService({ getProject: () => state.project, activeSelection: () => null,
		state: { history: createSoundscaperProjectHistory(state.admitted), selectedTrackId: 'track', selectedClipId: 'c0' },
		findClip, findClipTrack, findTrack, resolveEditingSelection, createClipboardDescriptor,
		editingBlocked: (allowCopy: boolean) => { assert.equal(allowCopy, true); return false; },
		setSessionClipboard: (value: AudioEditorClipboard) => { clipboard = value; }, compactLiveSourceState() {},
		garbageCollectSources: async () => undefined, publishDocumentSnapshot() {}, handleError: (error: unknown) => { errors.push(error); },
	})('copy');
	assert.deepEqual(errors, []);
	assert.ok(clipboard);
	assert.ok(state.memberships <= state.count * 20, `received ${state.memberships} owner membership reads`);
});

test('successive selection gestures retain track ownership until a media command changes it', () => {
	const work = fixture();
	let project = work.project;
	const unexpected = (): never => assert.fail('Clip selection must not render, persist settings, or mutate media.');
	const state: SelectionViewState = { selectedTrackId: 'track', selectedClipId: 'c0', selectedAnnotationId: null,
		analysisProcessing: false, showRms: false, showVerticalRulers: false, scrollViewToPlayhead: true,
		pinnedPlayhead: false, playbackOnRulerClick: false, timelineViewportWidth: 1000, pixelsPerSecond: 100 };
	const ownership = createSelectionOwnershipIndex(() => project,
		command => { project = { ...project, selection: { ...project.selection, ...command } }; return project; });
	const runtime: SelectionViewServiceRuntime<typeof project, { channels: readonly Float32Array[] }> = {
		DEFAULT_PIXELS_PER_SECOND: 100, MAX_PIXELS_PER_SECOND: 1000, activeSelection: () => null,
		audioBufferChannels: unexpected, cloneProject: unexpected, collectRelatedClipIds, commit: unexpected,
		copy: { audioTrackNotFound: '', audioClipNotFound: '', selectionFramesFinite: '', timelineFramesFinite: '', v2Required: '', zeroCrossingsAligned: '' },
		editorTimelineDurationFrames: unexpected, engine: { getPositionFrames: () => 0, getState: () => ({ state: 'stopped' }), seek: unexpected },
		findClip, findClipTrack, findNearestAudioZeroCrossing: unexpected, findTrack, getProject: () => project, getClipOwners: ownership.get,
		handleError: unexpected, normalizeTimelineFrame: Number, persistSetting: unexpected, productSettingKey: unexpected,
		projectDurationFrames: unexpected, projectSampleRate: () => 48_000, publishDocumentSnapshot() {}, publishProjectState() {},
		renderSnapshot: unexpected, resetRoutedInputMeter() {}, setStatus: unexpected, snapAudioEditorFrameWithProject: unexpected,
		state, synchronizeAutomaticSampleEditMode() {}, synchronizeMicrophoneMeterTarget() {}, updatePlayhead: unexpected,
		updateSelection: ownership.updateSelection,
	};
	const service = createSelectionViewService(runtime);
	service.selectClip('c499', { toggle: true });
	assert.equal(project.selection.clipIds?.length, 499);
	assert.ok(work.memberships <= work.count * 4, `received ${work.memberships} owner membership reads`);
	work.reset();
	service.selectClip('c499', { additive: true });
	assert.equal(project.selection.clipIds?.length, 500);
	assert.equal(state.selectedTrackId, 'track');
	assert.ok(work.memberships <= 2, `ownership was rebuilt with ${work.memberships} membership reads`);
	const moved = applySoundscaperProjectCommand(work.admitted, { type: 'batch', commands: [
		{ type: 'track/add', track: { id: 'moved', name: 'Moved', type: 'audio', clipIds: [] } },
		{ type: 'clip/move', clipId: 'c0', trackId: 'moved', timelineStartFrame: 0 },
	] });
	project = { ...moved, tracks: moved.tracks.map(track => { assert.ok(track.type === 'audio'); return track; }) };
	service.selectClip('c0');
	assert.equal(state.selectedTrackId, 'moved', 'a media command must replace the previous ownership generation');
});

test('Duplicate filters selected track identities with one owned catalog index', () => {
	const count = 500;
	const admitted = createSoundscaperProject({ id: 'duplicate-work',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 64 }],
		clips: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: 0 })),
		tracks: Array.from({ length: count }, (_, index) => ({ id: `t${index}`, clipIds: [`c${index}`] })),
	});
	const project = { ...admitted, tracks: admitted.tracks.map(track => { assert.ok(track.type === 'audio'); return track; }) };
	const original = Array.prototype.find;
	let visits = 0;
	Object.defineProperty(Array.prototype, 'find', { configurable: true, writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			return original.call(this, this === project.tracks
				? (value, index, values) => { visits++; return predicate.call(receiver, value, index, values); } : predicate, receiver);
		} });
	try {
		let sequence = 0;
		const plan = prepareDuplicateSelectionCommand({ getProject: () => project, createClipboardDescriptor,
			createStableId: (prefix = 'id') => `${prefix}-${sequence++}` },
		{ startFrame: 0, endFrame: 64, trackIds: project.tracks.map(track => track.id), exactClips: false });
		assert.ok(plan);
		assert.ok(visits <= count * 4, `received ${visits} track predicates`);
	} finally { Object.defineProperty(Array.prototype, 'find', { configurable: true, writable: true, value: original }); }
});
