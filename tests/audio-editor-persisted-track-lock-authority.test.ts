/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	capturePersistedTrackLockAuthority,
} from '../src/common/editor/controller/clip-video/internal/trim/persisted-track-lock-authority.ts';

test('persisted track-lock authority captures locked and unlocked rows', () => {
	const isTrackLocked = capturePersistedTrackLockAuthority({
		tracks: [
			{ id: 'locked', locked: true },
			{ id: 'unlocked', locked: false },
		],
	});
	assert.equal(isTrackLocked('locked'), true);
	for (const trackId of ['unlocked', 'missing']) {
		assert.equal(isTrackLocked(trackId), false, trackId);
	}
});

test('persisted track-lock authority is an immutable snapshot of one planning project read', () => {
	const track = { id: 'track', locked: true };
	const project = { tracks: [track] };
	const isTrackLocked = capturePersistedTrackLockAuthority(project);
	track.id = 'renamed';
	track.locked = false;
	project.tracks.push({ id: 'later-lock', locked: true });
	assert.equal(isTrackLocked('track'), true);
	assert.equal(isTrackLocked('renamed'), false);
	assert.equal(isTrackLocked('later-lock'), false);
});
