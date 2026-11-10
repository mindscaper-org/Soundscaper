/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangementSession } from './helpers/arrangement-session-custody.ts';

type Session = Awaited<ReturnType<typeof arrangementSession>>;
type Project = ReturnType<Session['project']>;

test('podcast pickup retains trimmed split dialogue, inserted sting, gain and track automation through Scape', async context => {
	const f = await arrangementSession(context, ['bed', 'a']);
	const bed = f.edit('bed', 4800, 326400, 2400, 4800, -2), track = f.track(bed).id;
	f.gain(bed, [{ frame: 84864, value: .5 }]);
	f.controller.actions.edit.splitAt(189312, [track]);
	assert.deepEqual(f.geometry('bed'), [[0, 189312, 4800], [189312, 137088, 194112]]);
	assert.equal(f.clips('bed')[0]?.fadeInFrames, 2400); assert.equal(f.clips('bed')[1]?.fadeOutFrames, 4800);
	for (const clip of f.clips('bed')) assert.equal(clip.gain, 10 ** (-2 / 20));
	const sting = f.clips('a')[0]; assert.ok(sting);
	f.controller.actions.timeline.selectClip(sting.id); await f.controller.actions.edit.copy();
	f.controller.actions.transport.seek(189312); await f.controller.actions.edit.pasteInsert();
	assert.deepEqual(f.geometry('a'), [[0, 38400, 0], [189312, 38400, 0]]);
	assert.equal(f.track(f.clips('a')[1]!.id).id, f.track(sting.id).id);
	assert.equal(f.clips('bed')[0]?.envelope?.some(point => point.frame === 84864 && point.value === .5), true);
	const before = f.project(); const laneId = f.automation(track);
	assert.deepEqual(f.project().automationLanes.find(lane => lane.id === laneId)?.points.map(point => [point.position, point.value]), [[0, .5], [384000, .75]]);
	assertHistory(f, before); const reopened = await f.reopen(); assert.equal(reopened.clips.length, 4);
});

test('chorus safety duplicate preserves fades, trim and gain beside a split verse and independent mute/solo rack', async context => {
	const f = await arrangementSession(context, ['a', 'b']);
	const verse = f.edit('a', 1200, 34800, 1200, 2400);
	const chorus = f.edit('b', 2400, 33600, 2400, 1200, -3), chorusTrack = f.track(chorus).id;
	f.controller.actions.edit.splitAt(16008, [f.track(verse).id]);
	assert.deepEqual(f.geometry('a'), [[0, 16008, 1200], [16008, 18792, 17208]]);
	f.controller.actions.timeline.selectClip(chorus); await f.controller.actions.edit.duplicate();
	assert.equal(f.clips('b').length, 2); assert.deepEqual(f.geometry('b'), [[0, 33600, 2400], [0, 33600, 2400]]);
	const duplicate = f.clips('b').find(clip => clip.id !== chorus); assert.ok(duplicate);
	for (const clip of f.clips('b')) {
		assert.equal(clip.fadeInFrames, 2400); assert.equal(clip.fadeOutFrames, 1200); assert.equal(clip.gain, 10 ** (-3 / 20));
	}
	f.controller.actions.track.update(chorusTrack, { mute: true });
	f.controller.actions.track.update(f.track(duplicate.id).id, { solo: true });
	const before = f.project();
	assert.ok(f.controller.actions.effects.add({ scope: 'track', trackId: f.track(verse).id, type: 'audacity-invert' }));
	assertHistory(f, before); const reopened = await f.reopen();
	assert.equal(reopened.tracks.find(track => track.id === chorusTrack)?.mute, true);
	assert.equal(reopened.tracks.find(track => track.id === f.track(duplicate.id).id)?.solo, true);
	assert.equal(reopened.clips.length, 4);
});

test('radio montage retains a gained ident and cut/pasted cue beside its split reverb bed', async context => {
	const f = await arrangementSession(context, ['bed', 'a', 'b']);
	const ident = f.edit('a', 1800, 32400, 2400, 4800, -1.5);
	assert.deepEqual(f.geometry('a'), [[0, 32400, 1800]]);
	f.gain(ident, [{ frame: 20088, value: .5 }]);
	const bed = f.clips('bed')[0], cue = f.clips('b')[0]; assert.ok(bed && cue);
	f.controller.actions.edit.splitAt(122880, [f.track(bed.id).id]);
	f.controller.actions.timeline.selectClip(cue.id); await f.controller.actions.edit.cutLeaveGap();
	assert.equal(f.clips('b').length, 0);
	f.controller.actions.transport.seek(122880); await f.controller.actions.edit.paste();
	assert.deepEqual(f.geometry('b'), [[122880, 38400, 0]]);
	assert.deepEqual(f.geometry('bed'), [[0, 122880, 0], [122880, 261120, 122880]]);
	const before = f.project(); assert.ok(f.controller.actions.effects.add({ scope: 'track', trackId: f.track(bed.id).id, type: 'audacity-reverb' }));
	assertHistory(f, before); const reopened = await f.reopen();
	assert.equal(reopened.clips.find(clip => clip.id === ident)?.gain, 10 ** (-1.5 / 20));
	assert.equal(reopened.clips.find(clip => clip.id === ident)?.fadeInFrames, 2400);
	assert.equal(reopened.clips.find(clip => clip.id === ident)?.fadeOutFrames, 4800);
	assert.deepEqual(reopened.clips.find(clip => clip.id === ident)?.envelope, [{ frame: 20088, value: .5 }]);
});

test('synchronized beat insert preserves all three source identities, clip gain and owned track automation', async context => {
	const f = await arrangementSession(context, ['bed', 'a', 'b']);
	const bass = f.edit('a', 2400, 31200, 1200, 2400); f.gain(bass, [{ frame: 10920, value: .5 }]);
	const beat = f.clips('bed')[0], accent = f.clips('b')[0]; assert.ok(beat && accent);
	const track = f.track(beat.id).id, laneId = f.automation(track);
	f.controller.actions.timeline.selectClip(beat.id); await f.controller.actions.edit.copy();
	f.controller.actions.transport.seek(0); await f.controller.actions.edit.pasteAllTracksRipple();
	assert.deepEqual(f.geometry('bed'), [[0, 384000, 0], [384000, 384000, 0]]);
	const pasted = f.clips('bed').find(clip => clip.id !== beat.id && clip.timelineStartFrame === 0); assert.ok(pasted);
	assert.equal(f.track(pasted.id).id, track); assert.equal(pasted.sourceDurationFrames, 384000);
	assert.equal(pasted.gain, 1); assert.equal(pasted.fadeInFrames, 96); assert.equal(pasted.fadeOutFrames, 96);
	assert.deepEqual(pasted.envelope, []);
	assert.deepEqual(f.geometry('a'), [[384000, 31200, 2400]]); assert.deepEqual(f.geometry('b'), [[384000, 38400, 0]]);
	assert.equal(f.clips('a')[0]?.id, bass); assert.equal(f.clips('b')[0]?.id, accent.id);
	const lane = f.project().automationLanes.find(lane => lane.id === laneId); assert.ok(lane);
	assert.equal(lane.points.find(point => point.id === 'begin')?.position, 384000);
	assert.equal(lane.points.find(point => point.id === 'end')?.position, 768000);
	assert.ok(lane.points.length > 2);
	const before = f.project(); f.controller.actions.edit.splitAt(403200, [f.track(accent.id).id]);
	assert.deepEqual(f.geometry('b'), [[384000, 19200, 0], [403200, 19200, 19200]]);
	assertHistory(f, before); const reopened = await f.reopen();
	assert.deepEqual(reopened.clips.find(clip => clip.id === bass)?.envelope, [{ frame: 10920, value: .5 }]);
	assert.equal(reopened.clips.find(clip => clip.id === bass)?.fadeInFrames, 1200);
	assert.equal(reopened.clips.find(clip => clip.id === bass)?.fadeOutFrames, 2400);
	assert.deepEqual(reopened.automationLanes, f.project().automationLanes);
});

test('audiobook pickup keeps exact breath gaps, source offsets, duplicate and automation after archive reopen', async context => {
	const f = await arrangementSession(context, ['bed']);
	const chapter = f.edit('bed', 12000, 300000, 2400, 7200, 1), track = f.track(chapter).id;
	f.controller.actions.edit.splitAt(141000, [track]);
	f.gain(chapter, [{ frame: 101520, value: .5 }]);
	f.controller.actions.timeline.setExactSelection(179160, 207780, { trackIds: [track] });
	await f.controller.actions.edit.deleteLeaveGap();
	assert.deepEqual(f.geometry('bed'), [[0, 141000, 12000], [141000, 38160, 153000], [207780, 92220, 219780]]);
	const tail = f.clips('bed').at(-1); assert.ok(tail);
	f.controller.actions.timeline.selectClip(tail.id); await f.controller.actions.edit.duplicate();
	assert.equal(f.clips('bed').length, 4);
	const duplicate = f.clips('bed').find(clip => clip.id !== tail.id && clip.timelineStartFrame === 207780); assert.ok(duplicate);
	assert.notEqual(f.track(duplicate.id).id, track);
	assert.equal(duplicate.sourceStartFrame, 219780); assert.equal(duplicate.durationFrames, 92220);
	assert.equal(duplicate.fadeOutFrames, 7200); assert.equal(duplicate.gain, 10 ** (1 / 20));
	const before = f.project(); f.automation(track); assertHistory(f, before);
	const reopened = await f.reopen(); assert.equal(reopened.clips.length, 4);
	assert.equal(f.clips('bed')[0]?.fadeInFrames, 2400);
	assert.equal(f.clips('bed')[0]?.envelope?.some(point => point.frame === 101520 && point.value === .5), true);
});

test('ambience layer retains partial clipboard insertion, gain points, cue mute and reverb through Scape', async context => {
	const f = await arrangementSession(context, ['bed', 'a']);
	const bed = f.edit('bed', 7200, 312000, 9600, 12000, -5), track = f.track(bed).id;
	f.gain(bed, [{ frame: 68640, value: .5 }, { frame: 227760, value: .25 }]);
	f.controller.actions.timeline.selectClip(bed);
	f.controller.actions.timeline.setExactSelection(56160, 106080, { trackIds: [track] });
	await f.controller.actions.edit.copy(); f.controller.actions.transport.seek(56160); await f.controller.actions.edit.pasteInsert();
	assert.deepEqual(f.geometry('bed'), [[0, 56160, 7200], [56160, 49920, 63360], [106080, 255840, 63360]]);
	assert.equal(f.clips('bed')[0]?.fadeInFrames, 9600); assert.equal(f.clips('bed')[2]?.fadeOutFrames, 12000);
	for (const clip of f.clips('bed')) assert.equal(clip.gain, 10 ** (-5 / 20));
	assert.equal(f.clips('bed')[1]?.envelope?.some(point => point.frame === 12480 && point.value === .5), true);
	assert.equal(f.clips('bed')[2]?.envelope?.some(point => point.frame === 171600 && point.value === .25), true);
	for (const clip of f.clips('bed')) assert.equal(f.track(clip.id).id, track);
	const cue = f.clips('a')[0]; assert.ok(cue); const cueTrack = f.track(cue.id).id;
	f.controller.actions.edit.splitAt(21120, [cueTrack]);
	assert.deepEqual(f.geometry('a'), [[0, 21120, 0], [21120, 17280, 21120]]);
	f.controller.actions.track.update(cueTrack, { mute: true });
	const before = f.project(); assert.ok(f.controller.actions.effects.add({ scope: 'track', trackId: track, type: 'audacity-reverb' }));
	assertHistory(f, before); const reopened = await f.reopen(); assert.equal(reopened.clips.length, 5);
	assert.equal(reopened.tracks.find(track => track.id === cueTrack)?.mute, true);
});

function assertHistory(f: Session, before: Project): void {
	const after = f.project(); f.controller.actions.edit.undo(); assert.deepEqual(content(f.project()), content(before));
	f.controller.actions.edit.redo(); assert.deepEqual(content(f.project()), content(after));
}
function content(value: Project) { const { revision: _revision, updatedAt: _updatedAt, ...document } = value; return document; }
