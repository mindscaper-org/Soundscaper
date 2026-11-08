/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';

function project(sidechain: boolean, keyMuted: boolean, targetMuted: boolean, position: 'pre-fader' | 'post-fader') {
	const sources = ['programme', 'key'].map(id => createAudioSource({ id, sampleRate: 48_000, frameCount: 48, channelCount: 1 }));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id, durationFrames: 48, sourceDurationFrames: 48 }));
	const programme = createAudioTrack({ id: 'programme', clipIds: ['programme-clip'], gain: .3, mute: targetMuted,
		effects: [createEffect('gate', { id: 'gate' })] });
	const key = createAudioTrack({ id: 'key', clipIds: ['key-clip'], gain: .4, mute: keyMuted });
	const base = createSoundscaperProject({ id: 'capture-detector', sources, clips, tracks: [programme, key] });
	return createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: [...base.mixer.edges,
		...(sidechain ? [{ id: 'key-feed', kind: 'sidechain' as const, source: { kind: 'track' as const, id: 'key' },
			destination: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: 'programme' }, effectId: 'gate' },
			position, enabled: true, level: 1, channelMap: [0] }] : []),
	] } });
}

for (const [keyMuted, targetMuted, position] of [
	[true, false, 'post-fader'], [false, false, 'post-fader'],
	[false, true, 'post-fader'], [true, false, 'pre-fader'],
] as const) test(`authored capture retains ${position} key mute=${keyMuted} without baking target mute=${targetMuted}`, async () => {
	const authored = project(true, keyMuted, targetMuted, position), before = structuredClone(authored);
	const harness = createHarness({ project: authored });
	await harness.service.renderDryTrackRange('programme', 0, 48, 1, null, null, 'authored');
	const snapshot = harness.snapshots[0]; assert.ok(snapshot);
	assert.equal(harness.renderRequests[0]?.respectMuteSolo, true, 'detector gates belong to the authored capture');
	const mixer = normalizeMixerGraphV21(snapshot.mixer);
	assert.equal(mixer.edges.find(edge => edge.id === 'key-feed')?.position, position);
	const programmeTap = mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'programme'
		&& edge.destination.kind === 'output');
	assert.ok(programmeTap); assert.equal(programmeTap.position, 'pre-fader'); assert.equal(programmeTap.level, .3);
	assert.equal(snapshot.tracks.find(track => track.id === 'key')?.mute, keyMuted);
	assert.equal(snapshot.tracks.find(track => track.id === 'key')?.gain, .4);
	assert.deepEqual(authored, before);
});

test('ordinary dry and authored captures without detectors retain their existing mute-ignore policy', async () => {
	for (const processing of ['dry', 'authored'] as const) {
		const harness = createHarness({ project: project(false, true, true, 'post-fader') });
		await harness.service.renderDryTrackRange('programme', 0, 48, 1, null, null, processing);
		assert.equal(harness.renderRequests[0]?.respectMuteSolo, false);
	}
});
