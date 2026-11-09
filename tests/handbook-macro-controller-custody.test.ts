/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { macroControllerCustody } from './helpers/macro-controller-custody.ts';
import { readHandbookMacroPrograms, NODE_CONTROLLER_PROGRAMS } from './helpers/handbook-macro-programs.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

const programs = readHandbookMacroPrograms();

test('the handbook fixtures cover all explicitly migrated programs and retain the saved DSP example', () => {
	assert.ok(programs.length >= 9);
	assert.equal(programs.filter(({ source }) => source.includes('sound.runSaved(')).length, 1);
	assert.deepEqual(programs.filter(({ title }) => NODE_CONTROLLER_PROGRAMS.has(title)).map(({ title }) => title), [...NODE_CONTROLLER_PROGRAMS]);
});

for (const entry of programs.filter(({ title }) => NODE_CONTROLLER_PROGRAMS.has(title))) {
	test(`handbook ${entry.title} uses the real macro controller and archive custody`, async context => {
		const { controller, assertArchiveCustody } = await macroControllerCustody(context, 384_000);
		const result: unknown = await controller.actions.macros.runScript({ name: entry.title, source: entry.source });
		assert.ok(result && typeof result === 'object' && 'calls' in result && typeof result.calls === 'number');
		assert.ok(result.calls > 0);
		const project = controller.project; assert.ok(validateSoundscaperProject(project));
		assert.equal(project.clips.length, 1); assert.equal(project.tracks.length, 1);
		const clip = project.clips[0]; assert.ok(clip?.kind === 'audio');
		const trimmed = entry.title === 'sound.command(name, params) (1)';
		assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames],
			[0, trimmed ? 240_000 : 384_000, 0, trimmed ? 240_000 : 384_000]);
		if (entry.title === 'Checking your assumptions (1)') {
			assert.deepEqual([project.selection.startFrame, project.selection.endFrame, project.selection.trackIds], [0, 384_000, ['voice']]);
		}
		if (entry.title === 'Errors (1)' || entry.title === 'Examples (2)') {
			assert.ok('log' in result && Array.isArray(result.log));
			assert.ok(result.log.some((line: unknown) => line && typeof line === 'object' && 'text' in line && line.text ===
				(entry.title === 'Errors (1)' ? 'refused: Unsupported macro command: ExportWav.' : 'Voice: 1 clip(s), 8.0 s of audio')));
		}
		if (trimmed) {
			await controller.actions.edit.undo();
			assert.equal(controller.project?.clips[0]?.durationFrames, 384_000);
			await controller.actions.edit.redo();
			assert.equal(controller.project?.clips[0]?.durationFrames, 240_000);
		}
		const reopened = await assertArchiveCustody();
		assert.equal(reopened.clips.length, 1); assert.equal(reopened.tracks.length, 1);
		assert.deepEqual(reopened.clips[0], clip);
	});
}
