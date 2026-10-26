/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createClipboardEditService, type ClipboardEditProject } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';

test('the actual Split clips at silences action captures each stable channel view once', async () => {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	let project = createSoundscaperProject({ id: 'silence-channel-work',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 }],
		tracks: [{ id: 'track', clipIds: ['clip'] }], clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: 48_000, durationFrames: 48_000, timelineStartFrame: 0 }],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track'], clipIds: ['clip'] } });
	const channels = [new Float32Array(48_000).fill(0.5), new Float32Array(48_000).fill(-0.5)];
	for (const channel of channels) channel.fill(0, 12_000, 24_000);
	let reads = 0, serial = 0;
	const service = createClipboardEditService({ lifetime,
		state: { selectedTrackId: 'track', selectedClipId: 'clip', clipboard: null }, copy: { noSilencesFound: 'No silences', track: 'Track' },
		session: { setClipboard: descriptor => ({ clipboard: { descriptor, sources: [] } }), clipboardForProject: () => null },
		sourceBuffers: new Map([['source', { sampleRate: 48_000, numberOfChannels: 2, getChannelData: (channel: number) => { reads++; return channels[channel]!; } }]]),
		getProject: () => project as unknown as ClipboardEditProject, editingBlocked: () => false,
		getPositionFrames: () => 0, normalizeFrame: value => Number(value), snapFrame: value => Number(value),
		createId: prefix => `${prefix}-${serial++}`, setStatus() {},
		commit: command => { project = applySoundscaperProjectCommand(project, command); } });
	await service.disjoinSelectedClip();
	assert.equal(reads, 2, `${reads} stable channel view reads`);
	const clips = projectForRuntimeConsumers(project).clips;
	assert.deepEqual(clips.map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames]), [[0, 0, 12_000], [24_000, 24_000, 24_000]]);
});
