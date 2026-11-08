/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackSelectionContextMenuItems, type TrackSelectionContextTrack } from '../src/common/editor/ui/timeline/track-selection-context-menu.ts';

const left = { id: 'left', type: 'audio', clipIds: ['left-clip'] };
const right = { id: 'right', type: 'audio', clipIds: ['right-clip'] };

for (const setting of ['mute', 'solo'] as const) {
	test(`the existing Make stereo action excludes a mono partner with different ${setting}`, () => {
		assert.equal(stereoDisabled([left, { ...right, [setting]: true }]), true);
	});
}

test('mono partners with matching audibility retain Make stereo admission', () => {
	assert.equal(stereoDisabled([left, { ...right, mute: false, solo: false }]), false);
	assert.equal(stereoDisabled([{ ...left, mute: true }, { ...right, mute: true }]), false);
	assert.equal(stereoDisabled([left, { ...right, mute: true }, { id: 'third', type: 'audio', clipIds: ['third-clip'] }]), false);
});

function stereoDisabled(tracks: readonly TrackSelectionContextTrack[]): boolean | undefined {
	const project = { tracks, clips: tracks.flatMap(track => (track.clipIds ?? []).map(id => ({ id, sourceId: 'mono' }))),
		sources: [{ id: 'mono', channelCount: 1 }] };
	const items = createTrackSelectionContextMenuItems({ project, track: tracks[0]!,
		copy: { trackChannels: 'Track channels', makeStereoTrack: 'Make stereo' },
		audioEffects: true, blocked: false, actions: { makeStereo() {} } });
	return items.audio[0]?.items?.find(item => item.id === 'track-make-stereo')?.disabled;
}
