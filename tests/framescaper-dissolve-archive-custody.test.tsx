/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoTransitionV1 } from '../src/common/editor/video-transition-v1.ts';
import { currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { assertDissolvePictureArchive, assertDissolvePicturePersisted, dissolveDocument, legacyCfrDissolvePictureCustody, mountDissolveCustody } from './helpers/framescaper-dissolve-archive-custody.tsx';

for (const [sampleRate, samples] of [[48_000, false], [44_100, true]] as const) test(`legacy CFR180 archive and real dissolve dialog author25 side-sequence frames from ${sampleRate}Hz ${samples ? 'samples' : 'seconds'}`, async context => {
	const f = await legacyCfrDissolvePictureCustody(context, { sampleRate, secondary: true });
	const dialog = await mountDissolveCustody(context, f, 'first');
	await dialog.seconds(samples ? '44100' : '1s', samples);
	const before = currentReviewedVideoProject(f.controller.project), entries = f.controller.getSnapshot().history.undoEntries.length;
	await dialog.perform();
	const edited = currentReviewedVideoProject(f.controller.project);
	assert.equal(f.controller.getSnapshot().history.undoEntries.length, entries + 1);
	const track = edited.tracks.find(track => track.id === 'pictures'); assert.ok(track);
	assert.ok(Array.isArray(track.videoTransitions));
	const transitions = track.videoTransitions.map(value => normalizeVideoTransitionV1(value));
	assert.equal(transitions.length, 1);
	const transition = transitions[0]; assert.ok(transition); assert.equal(transition.durationFrames, 25);
	const incoming = edited.clips.find(clip => clip.id === 'second'); assert.ok(incoming?.kind === 'video');
	assert.deepEqual([incoming.sequenceId, incoming.sequenceStartFrame, incoming.sequenceFrameCount, incoming.sourceInFrame, incoming.sourceFrameCount], ['cut', 50, 75, 90, 90]);
	await f.controller.actions.edit.undo(); assert.deepEqual(dissolveDocument(f.controller.project), dissolveDocument(before));
	await assertDissolvePicturePersisted(f);
	await f.controller.actions.edit.redo(); assert.deepEqual(dissolveDocument(f.controller.project), dissolveDocument(edited));
	await assertDissolvePictureArchive(context, f);
});

test('legacy CFR180 archive and real dissolve pair chooser address colon-containing identities without changing the other track', async context => {
	const rows: readonly (readonly [string, string, string])[] = [['t', 'a:b', 'c:d'], ['t:a', 'b:c', 'd']];
	const first = rows[0], second = rows[1]; assert.ok(first && second);
	const f = await legacyCfrDissolvePictureCustody(context, { rows });
	const dialog = await mountDissolveCustody(context, f, second[1]);
	await dialog.choosePair('Second out → Second in');
	const before = currentReviewedVideoProject(f.controller.project);
	await dialog.perform();
	const edited = currentReviewedVideoProject(f.controller.project);
	assert.deepEqual(edited.tracks[0], before.tracks[0]); assert.deepEqual(edited.clips.slice(0, 2), before.clips.slice(0, 2));
	const transitions: unknown = edited.tracks[1]?.videoTransitions; assert.ok(Array.isArray(transitions));
	const transition = normalizeVideoTransitionV1(transitions[0]);
	assert.equal(transition.durationFrames, 12);
	const incoming = edited.clips.find(clip => clip.id === second[2]); assert.ok(incoming?.kind === 'video');
	assert.deepEqual([incoming.sequenceStartFrame, incoming.sourceInFrame, incoming.sourceFrameCount, incoming.sequenceFrameCount], [18, 30, 30, 30]);
	await f.controller.actions.edit.undo(); assert.deepEqual(dissolveDocument(f.controller.project), dissolveDocument(before));
	await assertDissolvePicturePersisted(f);
	await f.controller.actions.edit.redo(); assert.deepEqual(dissolveDocument(f.controller.project), dissolveDocument(edited));
	await assertDissolvePictureArchive(context, f);
});
