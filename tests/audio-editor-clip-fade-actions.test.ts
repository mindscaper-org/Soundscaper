/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipFadeChangeCommand, clipFadeSessionCommand, clipFadeSessionPreviews } from '../src/common/editor/ui/timeline/clip-fade-actions.ts';

const first = { id: 'one', kind: 'audio', timelineStartFrame: 0, durationFrames: 1000, fadeInFrames: 0, fadeOutFrames: 800 };
const second = { ...first, id: 'two', timelineStartFrame: 2000, durationFrames: 500, fadeOutFrames: 50 };
const project = { clips: [first, second], tracks: [{ id: 'a', clipIds: ['one'] }, { id: 'b', clipIds: ['two'] }], selection: { clipIds: ['one', 'two'] } };
const session = { clipId: first.id, original: first, fadeTargets: [first, second] };

void test('curve presets create a bounded fade on each selected bare edge in one native batch', () => {
	const command = clipFadeChangeCommand(project, 'one', 1000, { fadeInShape: 3 });
	assert.deepEqual(command?.commands, [
		{ type: 'clip/update', clipId: 'one', changes: { fadeInFrames: 250, fadeOutFrames: 750, fadeInShape: 3 } },
		{ type: 'clip/update', clipId: 'two', changes: { fadeInFrames: 125, fadeInShape: 3 } },
	]);
	const linear = clipFadeChangeCommand(project, 'one', 1000, { fadeInShape: undefined });
	assert.equal(linear?.commands[0]?.type === 'clip/update' && linear.commands[0].changes.fadeInFrames, 250);
	assert.equal(linear?.commands[0]?.type === 'clip/update' && Object.hasOwn(linear.commands[0].changes, 'fadeInShape'), true);
	const existing = clipFadeChangeCommand(project, 'one', 1000, { fadeOutShape: 1 });
	assert.deepEqual(existing?.commands[0], { type: 'clip/update', clipId: 'one', changes: { fadeOutShape: 1 } });
});

void test('preset creation retains one-sample fades and caps long clips at half a second', () => {
	for (const [durationFrames, expected] of [[1, 1], [10_000, 500]] as const) {
		const clip = { ...first, durationFrames, fadeOutFrames: 0 };
		const command = clipFadeChangeCommand({ ...project, clips: [clip] }, 'one', 1000, { fadeOutShape: 2 });
		assert.deepEqual(command?.commands, [{ type: 'clip/update', clipId: 'one', changes: { fadeOutFrames: expected, fadeOutShape: 2 } }]);
	}
});

test('captured fade previews use each owning track and the same per-clip changes as commit', () => {
	const edit = { kind: 'length', edge: 'in', frames: 300 } as const;
	const draft = clipFadeSessionPreviews(session, project, 1000, edit);
	assert.deepEqual(draft.previews, [
		{ clipId: 'one', trackId: 'a', fadeInFrames: 300, fadeOutFrames: 700, fadeInShape: 2 },
		{ clipId: 'two', trackId: 'b', fadeInFrames: 300, fadeInShape: 2 },
	]);
	const command = clipFadeSessionCommand(session, project, 1000, edit);
	assert.deepEqual(command?.commands, draft.previews.map(({ clipId, trackId: _trackId, ...changes }) => ({ type: 'clip/update', clipId, changes })));
});

test('a gesture retains captured targets when selection changes and refuses a stale companion', () => {
	const edit = { kind: 'shape', edge: 'out', shape: 3 } as const;
	assert.equal(clipFadeSessionCommand(session, { ...project, selection: { clipIds: [] } }, 1000, edit)?.commands.length, 2);
	for (const clips of [[first], [first, { ...second, fadeOutFrames: 51 }], [first, { ...second, timelineStartFrame: 2001 }]]) {
		assert.equal(clipFadeSessionCommand(session, { ...project, clips }, 1000, edit), null);
	}
});

test('keyboard length intent pushes each opposite independently while property edits suppress no-op history', () => {
	const command = clipFadeChangeCommand(project, first.id, 1000, { fadeInFrames: 300, fadeOutFrames: 700 }, 'in');
	assert.deepEqual(command?.commands[1], { type: 'clip/update', clipId: 'two', changes: { fadeInFrames: 300, fadeInShape: 2 } });
	assert.equal(clipFadeChangeCommand(project, first.id, 1000, {}), null);
	const onlySecond = clipFadeChangeCommand({ ...project, selection: { clipIds: ['one'] } }, second.id, 1000, { fadeOutFrames: 0 });
	assert.equal(onlySecond?.commands.length, 1);
	assert.equal(onlySecond?.commands[0]?.type === 'clip/update' && onlySecond.commands[0].clipId, 'two');
});
