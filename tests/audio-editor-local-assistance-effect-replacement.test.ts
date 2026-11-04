/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	defaultAssistanceWorkflowSettingsV1,
	validateAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { authority, harness, request } from './helpers/local-assistance-audio-publication-fixture.ts';
import { AudioStore, SOURCE_SHA256 } from './helpers/local-assistance-audio-publication-fixture.ts';
import { createLocalAssistanceAudioPublicationAcceptance } from '../src/common/editor/controller/assistance/internal/audio/local-assistance-audio-publication.ts';
import { resolveLocalAssistanceSelectedMediaAuthority } from '../src/common/editor/controller/assistance/internal/local-assistance-selected-media.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';
import {
	createAudioClip, createAudioSource, createAudioTrack, createVideoClip, createVideoSource, createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/document/internal/command-capability-policy.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';

type Command = Readonly<Record<string, unknown>>;

test('audio effect recipes replace the current selection without a destination setting', () => {
	for (const workflowId of ['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects'] as const) {
		const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
		assert.equal('placement' in settings && settings.placement, 'replace-selection');
		assert.deepEqual(validateAssistanceWorkflowSettingsV1(settings), settings);
	}
});

test('audio effect acceptance replaces the selected range by default without Project Bin output', async () => {
	for (const operation of ['speech-enhancement', 'dereverberation'] as const) {
		const fixture = harness();
		await fixture.acceptance.acceptValidatedResult(await request(operation));
		const batch = fixture.commits[0] as Readonly<{ commands: readonly Command[] }>;
		assert.deepEqual(batch.commands.map(({ type }) => type), [
			'source/add', 'range/lift-delete', 'clip/add', 'selection/set',
		]);
		assert.equal(batch.commands[1]!.startFrame, 24_000);
		assert.equal(batch.commands[1]!.endFrame, 24_004);
	}
});

test('separation replaces the selection with Dialogue and aligned audible Music and Effects tracks', async () => {
	const fixture = harness();
	await fixture.acceptance.acceptValidatedResult(await request('source-separation'));
	const batch = fixture.commits[0] as Readonly<{ commands: readonly Command[] }>;
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		batch, PRODUCT_PROFILES.soundscaper.capabilities, 'Soundscaper',
	));
	assert.equal(batch.commands.filter(({ type }) => type === 'source/add').length, 3);
	assert.equal(batch.commands.filter(({ type }) => type === 'range/lift-delete').length, 1);
	assert.equal(batch.commands.filter(({ type }) => type === 'project-bin/add').length, 0);
	const clips = batch.commands.filter(({ type }) => type === 'clip/add');
	assert.equal(clips.length, 3);
	assert.equal(clips[0]!.trackId, 'dialogue-track');
	assert.deepEqual(batch.commands.filter(({ type }) => type === 'track/add')
		.map(({ track }) => {
			const value = track as Command;
			return { name: value.name, mute: value.mute };
		}), [{ name: 'Music', mute: false }, { name: 'Effects', mute: false }]);
	for (const { clip } of clips) {
		assert.equal((clip as Command).timelineStartFrame, 24_000);
		assert.equal((clip as Command).durationFrames, 4);
	}
});

test('linked audio replacement detaches its authenticated A/V relationship in the same undoable batch', async () => {
	const fixture = harness(authority(7, { avLinkId: 'linked-av' }));
	await fixture.acceptance.acceptValidatedResult(await request('speech-enhancement'));
	const batch = fixture.commits[0] as Readonly<{ commands: readonly Command[] }>;
	assert.deepEqual(batch.commands.map(({ type }) => type), [
		'source/add', 'clip/unlink-av', 'range/lift-delete', 'clip/add', 'selection/set',
	]);
	assert.equal(batch.commands[1]!.clipId, 'dialogue-clip');
	assert.deepEqual(batch.commands[2]!.clipIds, ['dialogue-clip']);
});

test('selection replacement preserves surrounding audio and picture, and one undo restores links and stems', async () => {
	for (const operation of ['speech-enhancement', 'dereverberation', 'source-separation'] as const) {
		const original = linkedProject();
		type History = ReturnType<typeof createEditorHistory> & { present: AudioEditorProjectCurrent };
		let history = createEditorHistory(original) as History;
		let focus: Readonly<{ selectClipId: string; selectTrackId: string }> | undefined;
		const selection = {
			getProject: () => ({ ...history.present, schemaFamily: 'soundscaper' as const, schemaVersion: 1 }),
			getSelectedClipId: () => focus?.selectClipId ?? 'dialogue-clip', captureProject: () => history.present,
			assertProject: (token: unknown) => assert.equal(token, history.present),
			renderDryTrackRange: async () => [new Float32Array(4), new Float32Array(4)],
		};
		let nextId = 0;
		const acceptance = createLocalAssistanceAudioPublicationAcceptance({
			currentAuthority: () => resolveLocalAssistanceSelectedMediaAuthority(selection),
			captureProject: selection.captureProject, assertProject: selection.assertProject,
			createId: (prefix) => `${prefix}-${String(++nextId)}`,
			preflightStorage: async () => undefined, store: new AudioStore([]),
			commit: (command, selected) => {
				focus = selected;
				history = executeEditorCommand(history, command as AudioEditorCommand) as History;
			},
		});
		const selected = resolveLocalAssistanceSelectedMediaAuthority(selection);
		await acceptance.acceptValidatedResult(await request(operation, selected.fence));
		assert.equal(focus?.selectTrackId, 'dialogue-track');
		assert.deepEqual(history.present.selection.clipIds, [focus?.selectClipId]);
		const reapplied = resolveLocalAssistanceSelectedMediaAuthority(selection);
		assert.equal(reapplied.source.sampleRate, 48_000);
		assert.equal(reapplied.clip.sourceDurationFrames, reapplied.clip.durationFrames);
		assert.equal(history.present.projectBin.clips.length, 0);
		const picture = history.present.clips.find(({ id }) => id === 'picture-clip')!;
		assert.deepEqual({ ...picture, avLinkId: 'linked-av' }, original.clips[0]);
		const audioTrack = history.present.tracks.find(({ id }) => id === 'dialogue-track')!;
		assert.ok(Array.isArray(audioTrack.clipIds));
		const trackClipIds: readonly unknown[] = audioTrack.clipIds;
		const remaining = history.present.clips.filter(({ id }) => trackClipIds.includes(id))
			.sort((left, right) => Number(left.timelineStartFrame) - Number(right.timelineStartFrame));
		assert.deepEqual(remaining.map(({ timelineStartFrame, durationFrames }) => (
			{ timelineStartFrame, durationFrames }
		)), [
			{ timelineStartFrame: 0, durationFrames: 12_000 },
			{ timelineStartFrame: 12_000, durationFrames: 4 },
			{ timelineStartFrame: 12_004, durationFrames: 35_996 },
		]);
		assert.equal(history.present.tracks.length, operation === 'source-separation' ? 4 : 2);
		history = undoEditorCommand(history) as History;
		assert.deepEqual(history.present.clips, original.clips);
		assert.deepEqual(history.present.tracks, original.tracks);
		assert.deepEqual(history.present.sources, original.sources);
		const restored = resolveLocalAssistanceSelectedMediaAuthority(selection);
		assert.equal(restored.clip.id, 'dialogue-clip', 'undo recovers the restored selection despite stale focus');
		assert.equal(restored.source.contentSha256, SOURCE_SHA256);
	}
});

function linkedProject(): AudioEditorProjectCurrent {
	const rate = { num: 30, den: 1 };
	const pictureSource = createVideoSource({ id: 'picture-source', name: 'Picture',
		storageKey: 'picture-source', sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: rate, width: 1_920, height: 1_080 });
	const picture = createVideoClip({ id: 'picture-clip', sourceId: pictureSource.id,
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 30,
		sourceInFrame: 0, sourceFrameCount: 30, avLinkId: 'linked-av' }, {
		projectSampleRate: 48_000, sequence: { id: 'main-sequence', rate }, source: pictureSource,
	});
	const source = createAudioSource({ id: 'dialogue-source', name: 'Dialogue',
		storageKey: 'dialogue-source', frameCount: 48_000, channelCount: 2,
		sampleRate: 48_000, contentSha256: SOURCE_SHA256 });
	const clip = createAudioClip({ id: 'dialogue-clip', sourceId: source.id,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		durationFrames: 48_000, avLinkId: 'linked-av' });
	const tracks = [
		createVideoTrack({ id: 'picture-track', clipIds: [picture.id], laneGroupId: 'camera-lanes' }),
		createAudioTrack({ id: 'dialogue-track', clipIds: [clip.id], laneGroupId: 'camera-lanes' }),
	];
	return createCurrentAudioEditorProject({ id: 'project-1', title: 'Linked effect replacement',
		sampleRate: 48_000, sources: [pictureSource, source], clips: [picture, clip], tracks,
		sequences: [{ id: 'main-sequence', rate, trackIds: tracks.map(({ id }) => id) }],
		primarySequenceId: 'main-sequence', selection: { startFrame: 12_000, endFrame: 12_004,
			trackIds: ['dialogue-track'], clipIds: [clip.id] } });
}
