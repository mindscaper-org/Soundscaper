/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { rackEffectChannelCount, unavailableRackEffectTypes } from '../src/common/editor/rack-effect-channel-width.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('manual rack admission respects independent source, bus and master channel layouts', () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48000, frameCount: 100, channelCount: 6 });
	const base = createSoundscaperProject({ masterChannels: 6, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 100, sourceDurationFrames: 100 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const strip = (id: string, channelCount: number) => ({ id, name: id, channelCount, color: '#808080', gain: 1, pan: 0,
		mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		groups: [strip('wide-group', 6), strip('stereo-group', 2)], sends: [strip('wide-send', 6)] } });
	for (const [scope, id] of [['track', 'track'], ['group', 'wide-group'], ['send', 'wide-send'], ['master', null]] as const) {
		assert.equal(rackEffectChannelCount(project, scope, id), 6);
		assert.deepEqual(unavailableRackEffectTypes(project, scope, id), ['compressor', 'convolver', 'reverb']);
	}
	assert.equal(rackEffectChannelCount(project, 'group', 'stereo-group'), 2);
	assert.deepEqual(unavailableRackEffectTypes(project, 'group', 'stereo-group'), []);
});
