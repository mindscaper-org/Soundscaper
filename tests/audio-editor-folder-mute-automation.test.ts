/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import { scheduleAutomationLaneV21 } from '../src/common/editor/engine/automation-lane-scheduler-v21.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { inheritTrackFolderMediaStateProjectionV12, projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';
import { MockAudioContext, MockParam } from './helpers/mock-audio-context.js';

class Parameter extends MockParam { cancelScheduledValues() {} }
class Context extends MockAudioContext {
	createGain() { return Object.assign(super.createGain(), { gain: new Parameter(1) }); }
}

function fixture(parentMuted: boolean, nested = false) {
	const lane = normalizeAutomationLaneV21({ id: 'mute', address: { kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'mute' },
		timebase: 'absolute-samples', points: [0, 1, 0].map((value, index) => ({ id: `point-${index}`, position: index * 128, value })),
		segments: [{ kind: 'hold' }, { kind: 'hold' }] });
	const source = createAudioSource({ id: 'source', frameCount: 48000, channelCount: 1 });
	const authored = createSoundscaperProject({ id: 'folder-mute-lane', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48000 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'], mute: true })], automationLanes: [lane],
		trackFolders: [{ id: 'folder', name: 'Folder', mute: parentMuted }, ...(nested ? [{ id: 'nested', name: 'Nested' }] : [])],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'folder', id: 'folder' },
			...(nested ? [{ kind: 'folder', id: 'nested', parentFolderId: 'folder' }] : []),
			{ kind: 'track', id: 'track', parentFolderId: nested ? 'nested' : 'folder' }] }], primarySequenceId: 'main' });
	return { lane, project: { ...authored, tracks: authored.tracks.map(track => ({ ...track })),
		clips: authored.clips.map(clip => ({ ...clip })), mixer: { ...authored.mixer,
			groups: authored.mixer.groups.map(group => ({ ...group })), sends: authored.mixer.sends.map(send => ({ ...send })) } } };
}

for (const nested of [false, true]) test(`folder mute remains closed over three local automation blocks (nested=${nested})`, () => {
	const { project, lane } = fixture(true, nested), before = structuredClone(project);
	const context = new Context();
	const graph = buildProjectGraphV21(context as unknown as BaseAudioContext, context.destination as unknown as AudioNode,
		projectTrackFolderMediaStateV12(project), { metering: false });
	const target = graph.parameterRegistry.get(lane.address); assert.ok(target?.binding.kind === 'audio-param');
	for (let index = 0; index < 3; index++) {
		context.currentTime = index * 128 / 48000;
		scheduleAutomationLaneV21(lane, graph.parameterRegistry, { fromFrame: index * 128, toFrame: index * 128 + 127,
			contextStartTime: context.currentTime, sampleRate: 48000, contextSampleRate: 48000, transportRate: 1 });
		assert.equal(target.binding.params[0]?.param.value, 0, `block ${index} cannot open an ancestor's mute`);
	}
	assert.deepEqual(structuredClone(project), before);
});

test('a local mute lane opens the track when its parent is clear', () => {
	const { project, lane } = fixture(false), context = new Context();
	const graph = buildProjectGraphV21(context as unknown as BaseAudioContext, context.destination as unknown as AudioNode,
		projectTrackFolderMediaStateV12(project), { metering: false });
	const target = graph.parameterRegistry.get(lane.address); assert.ok(target?.binding.kind === 'audio-param');
	for (const [index, expected] of [1, 0, 1].entries()) {
		scheduleAutomationLaneV21(lane, graph.parameterRegistry, { fromFrame: index * 128, toFrame: index * 128 + 127,
			contextStartTime: index * 128 / 48000, sampleRate: 48000, contextSampleRate: 48000, transportRate: 1 });
		assert.equal(target.binding.params[0]?.param.value, expected);
	}
});

test('an explicitly unmuted detached print retains its existing override after inheriting projection custody', () => {
	const { project, lane } = fixture(true), projected = projectTrackFolderMediaStateV12(project);
	const print = inheritTrackFolderMediaStateProjectionV12(projected, { ...projected,
		tracks: projected.tracks.map(track => ({ ...track, mute: false })) });
	const context = new Context();
	const graph = buildProjectGraphV21(context as unknown as BaseAudioContext, context.destination as unknown as AudioNode,
		print, { metering: false });
	const target = graph.parameterRegistry.get(lane.address); assert.ok(target?.binding.kind === 'audio-param');
	for (const [index, expected] of [1, 0, 1].entries()) {
		scheduleAutomationLaneV21(lane, graph.parameterRegistry, { fromFrame: index * 128, toFrame: index * 128 + 127,
			contextStartTime: index * 128 / 48000, sampleRate: 48000, contextSampleRate: 48000, transportRate: 1 });
		assert.equal(target.binding.params[0]?.param.value, expected);
	}
});
