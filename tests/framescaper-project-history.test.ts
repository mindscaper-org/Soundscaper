/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import {
	createFramescaperProjectHistory as createHistory,
	executeFramescaperProjectCommand as execute,
	redoFramescaperProjectCommand as redo,
	undoFramescaperProjectCommand as undo,
	validateFramescaperProjectHistory as validate,
	type FramescaperProjectHistory,
} from '../src/framescaper/editor-project-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

const RENAME = Object.freeze({ type: 'project/rename', title: 'Renamed' });
const CREATED_AT = '2025-12-31T00:00:00.000Z';
const OPTIONS = Object.freeze({ now: new Date('2026-01-01T00:00:00.000Z') });

test('the retired retime history wrapper is absent from the source tree', async () => {
	const wrapper = new URL('../src/framescaper/editor-project-retime-history.ts', import.meta.url);
	await assert.rejects(access(wrapper), { code: 'ENOENT' });
});

function history(): FramescaperProjectHistory {
	return createHistory(PROFILE, createFramescaperProject(PROFILE, { now: CREATED_AT }));
}

function stacks(value: FramescaperProjectHistory): Readonly<{ undo: number; redo: number; title: string }> {
	return {
		undo: value.undoStack.length,
		redo: value.redoStack.length,
		title: value.present.title,
	};
}

test('a fresh history holds the project with both stacks empty', () => {
	const initial = history();

	assert.deepEqual(stacks(initial), { undo: 0, redo: 0, title: 'Untitled project' });
});

test('a history validates against its own runtime profile', () => {
	assert.equal(validate(PROFILE, history()), true);
	assert.throws(() => validate(PROFILE, {}), /Framescaper history must be exact/u);
});

test('executing a command advances the present and records one undo step', () => {
	const executed = execute(PROFILE, history(), RENAME, OPTIONS);

	assert.deepEqual(stacks(executed), { undo: 1, redo: 0, title: 'Renamed' });
});

test('undo restores the previous present and offers the command for redo', () => {
	const executed = execute(PROFILE, history(), RENAME, OPTIONS);
	const undone = undo(PROFILE, executed);

	assert.deepEqual(stacks(undone), { undo: 0, redo: 1, title: 'Untitled project' });
});

test('redo reapplies the undone command and returns it to the undo stack', () => {
	const executed = execute(PROFILE, history(), RENAME, OPTIONS);
	const undone = undo(PROFILE, executed);
	const redone = redo(PROFILE, undone);

	assert.deepEqual(stacks(redone), { undo: 1, redo: 0, title: 'Renamed' });
});

test('history navigation advances the revision rather than rewinding it', () => {
	const initial = history();
	const executed = execute(PROFILE, initial, RENAME, OPTIONS);
	const undone = undo(PROFILE, executed);
	const redone = redo(PROFILE, undone);

	assert.equal(executed.present.revision, initial.present.revision + 1);
	assert.equal(undone.present.revision, executed.present.revision + 1);
	assert.equal(
		redone.present.revision,
		undone.present.revision + 1,
		'undo and redo are themselves recorded revisions, so a redone project is '
		+ 'never byte-identical to the one it reproduces',
	);
	assert.equal(redone.present.title, executed.present.title);
});

test('undo and redo at the ends of the stack leave the history unchanged', () => {
	const initial = history();

	assert.deepEqual(undo(PROFILE, initial), initial);
	assert.deepEqual(redo(PROFILE, initial), initial);
});

test('executing a new command discards a pending redo branch', () => {
	const executed = execute(PROFILE, history(), RENAME, OPTIONS);
	const undone = undo(PROFILE, executed);
	const branched = execute(PROFILE, undone, { type: 'project/rename', title: 'Other' }, OPTIONS);

	assert.deepEqual(stacks(branched), { undo: 1, redo: 0, title: 'Other' });
});
