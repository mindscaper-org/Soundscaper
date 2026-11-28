/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createFramescaperProjectHistory,
	executeFramescaperProjectCommand,
	redoFramescaperProjectCommand,
	undoFramescaperProjectCommand,
} from '../src/framescaper/editor-project-history.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const CREATED_AT = '2026-08-28T10:00:00.000Z';
const EDITED_AT = '2026-08-28T10:01:00.000Z';
const UNDONE_AT = '2026-08-28T10:02:00.000Z';
const REDONE_AT = '2026-08-28T10:03:00.000Z';

test('common history snapshots commands at every history ownership boundary', () => {
	const command: AudioEditorCommand = { type: 'project/rename', title: 'Edited' };
	const initial = createEditorHistory(createCurrentAudioEditorProject({ now: CREATED_AT }));
	const executed = executeEditorCommand(initial, command, { now: EDITED_AT });
	assert.notStrictEqual(executed.undoStack[0]?.command, command);

	const undone = undoEditorCommand(executed, { now: UNDONE_AT });
	assert.notStrictEqual(undone.redoStack[0]?.command, executed.undoStack[0]?.command);

	const redone = redoEditorCommand(undone, { now: REDONE_AT });
	assert.notStrictEqual(redone.undoStack[0]?.command, undone.redoStack[0]?.command);
});

test('Soundscaper history omits the unused full-stack clone entry points', async () => {
	const [history, productionHistory] = await Promise.all([
		import('../src/soundscaper/editor-project-history.ts'),
		import('../src/soundscaper/editor-project-production-history.ts'),
	]);
	assert.equal(Reflect.has(history, 'cloneSoundscaperProjectHistory'), false);
	assert.equal(Reflect.has(productionHistory, 'cloneSoundscaperProductionHistory'), false);
});

test('Soundscaper production history snapshots commands when moving between stacks', () => {
	const command = { type: 'project/rename', title: 'Edited' } as const;
	const initial = createSoundscaperProjectHistory(createSoundscaperProject({ now: CREATED_AT }));
	const executed = executeSoundscaperProjectCommand(initial, command, { now: EDITED_AT });
	assert.notStrictEqual(executed.undoStack[0]?.command, command);

	const undone = undoSoundscaperProjectCommand(executed, { now: UNDONE_AT });
	assert.notStrictEqual(undone.redoStack[0]?.command, executed.undoStack[0]?.command);

	const redone = redoSoundscaperProjectCommand(undone, { now: REDONE_AT });
	assert.notStrictEqual(redone.undoStack[0]?.command, undone.redoStack[0]?.command);
});

test('the unused Framescaper sequence history wrapper is absent from the source tree', async () => {
	const history = new URL('../src/framescaper/editor-project-sequence-history.ts', import.meta.url);
	await assert.rejects(access(history), { code: 'ENOENT' });
});

test('Framescaper project history snapshots commands when moving between stacks', () => {
	const command: AudioEditorCommand = { type: 'project/rename', title: 'Edited' };
	const profile = FRAMESCAPER_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProject(profile, { now: CREATED_AT });
	const initial = createFramescaperProjectHistory(profile, project);
	const executed = executeFramescaperProjectCommand(
		profile,
		initial,
		command,
		{ now: EDITED_AT },
	);
	assert.deepEqual(executed.undoStack[0]?.command, command);
	assert.notStrictEqual(executed.undoStack[0]?.command, command);

	const undone = undoFramescaperProjectCommand(profile, executed, { now: UNDONE_AT });
	assert.deepEqual(undone.redoStack[0]?.command, command);
	assert.notStrictEqual(undone.redoStack[0]?.command, executed.undoStack[0]?.command);

	const redone = redoFramescaperProjectCommand(profile, undone, { now: REDONE_AT });
	assert.deepEqual(redone.undoStack[0]?.command, command);
	assert.notStrictEqual(redone.undoStack[0]?.command, undone.redoStack[0]?.command);
});
