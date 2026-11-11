/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createClipboardCustody, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

for (const extent of ['beat', 'sample'] as const) for (const automated of [false, true]) test(`NP036: per-track ripple delete resolves musical ${extent} extent, automation=${automated}`, async context => {
	const custody = await createClipboardCustody(context), { controller, store } = custody;
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const originalPcm = [new Float32Array(48_000).fill(.25)];
	const project = createSoundscaperProject({ id: 'musical-ripple', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['first', 'later'] })], clips: ['first', 'later'].map((id, index) =>
			createAudioClip({ id, title: id === 'first' ? 'First' : 'Later', sourceId: source.id, anchor: 'musical', musicalStartBeat: index * 8,
				musicalExtent: extent, ...(extent === 'beat' ? { musicalDurationBeats: 2 } : { durationFrames: 48_000 }), sourceDurationFrames: 48_000 })),
		automationLanes: automated ? [normalizeAutomationLaneV21({ id: 'ride',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' }, timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 1 }, { id: 'later-gain', position: 192_000, value: .25 }], segments: [{ kind: 'linear' }],
		})] : [],
	});
	await custody.open(project, new Map([[source.id, originalPcm]]));
	const imported = clipboardProject(controller.project);
	assert.deepEqual(imported.sources, project.sources);
	assert.deepEqual(imported.clips.map(clip => [clip.id, clip.title, clip.musicalStartBeat, clip.sourceDurationFrames]),
		[['first', 'First', { num: 0, den: 1 }, 48_000], ['later', 'Later', { num: 8, den: 1 }, 48_000]]);
	controller.actions.timeline.selectClip('first'); const before = clipboardProject(controller.project);
	assert.deepEqual(before.selection.clipIds, ['first']);
	const entries = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.deletePerTrackRipple();
	const result: unknown = controller.project; assert.ok(validateSoundscaperProject(result));
	assert.equal(result.clips.length, 1, JSON.stringify(controller.getSnapshot().status));
	assert.equal(resolveRuntimeProjectProjection(result).clips[0]?.timelineStartFrame, 144_000);
	assert.deepEqual(result.clips[0]?.musicalStartBeat, { num: 6, den: 1 });
	assert.deepEqual(result.tracks[0]?.clipIds, ['later']);
	assert.equal(result.clips[0]?.id, 'later');
	assert.deepEqual(result.sources, before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	if (automated) assert.equal(result.automationLanes[0]?.points.find(point => point.id === 'later-gain')?.position, 144_000);
	controller.actions.edit.undo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...before, revision: 0, updatedAt: '' });
	controller.actions.edit.redo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...result, revision: 0, updatedAt: '' });
	await controller.actions.project.flush();
	assert.deepEqual(await store.loadProject(result.id), controller.project);
	if (extent === 'beat' && !automated) {
		const reopened = await custody.archive((name, channels) => {
			assert.equal(name, source.name);
			assertPcmChannelsEqual(channels, originalPcm, 'every original musical-ripple PCM sample');
		});
		assert.equal(reopened.clips[0]?.id, 'later');
		assert.deepEqual(reopened.clips[0]?.musicalStartBeat, { num: 6, den: 1 });
	}
});
