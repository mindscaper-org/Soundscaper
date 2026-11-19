/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectFoundationCommand } from '../src/soundscaper/editor-project-command-foundation.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

test('inherited commands clone their mutation draft without cloning the untouched input authority', () => {
	for (const command of [
		{ type: 'project/rename', title: 'Renamed' },
		{ type: 'selection/set', startFrame: 10, endFrame: 20 },
		{ type: 'master/update', changes: { gain: 0.5 } },
	] satisfies AudioEditorCommand[]) {
		const project = createSoundscaperProject();
		const prior = structuredClone(project);
		const clone = globalThis.structuredClone;
		let inputClones = 0;
		globalThis.structuredClone = <Value>(value: Value, options?: StructuredSerializeOptions): Value => {
			if (value === project) inputClones++;
			return clone(value, options);
		};
		try {
			const result = applySoundscaperProjectFoundationCommand(project, command, { now: '2026-10-06T00:00:00Z' });
			assert.equal(inputClones, 0);
			assert.deepEqual(project, prior);
			assert.notEqual(result, project);
			assert.equal(result.revision, project.revision + 1);
		} finally { globalThis.structuredClone = clone; }
	}
});

test('failed inherited commands leave the original nested authority unchanged', () => {
	const project = createSoundscaperProject();
	const prior = structuredClone(project);
	assert.throws(() => applySoundscaperProjectFoundationCommand(project,
		{ type: 'selection/set', startFrame: 0, endFrame: 10, trackIds: ['missing'] }));
	assert.deepEqual(project, prior);
});

test('inherited metadata edits publish detached immutable capability declarations', () => {
	const project = createSoundscaperProject();
	const result = applySoundscaperProjectFoundationCommand(project,
		{ type: 'metadata/update', changes: { tags: { $soundscaperOpaqueBinary: 'Editor credit' } } });
	const { featureRequirements } = result;
	assert.equal(result.metadata.tags.$soundscaperOpaqueBinary, 'Editor credit');
	assert.equal(project.metadata.tags.$soundscaperOpaqueBinary, undefined);
	assert.notEqual(featureRequirements, project.featureRequirements);
	const requirement = featureRequirements.requirements.find(row => row.id === 'soundscaper.literal-json-keys');
	assert.ok(requirement);
	assert.ok(Object.isFrozen(requirement));
	assert.ok(Object.isFrozen(featureRequirements.requirements));
	assert.ok(Object.isFrozen(featureRequirements));
});

test('empty nested batches preserve the untouched input even when it is frozen', () => {
	const project = Object.freeze(createSoundscaperProject());
	const features = project.featureRequirements;
	const result = applySoundscaperProjectFoundationCommand(project,
		{ type: 'batch', commands: [{ type: 'batch', commands: [] }] });
	assert.equal(result, project);
	assert.equal(project.featureRequirements, features);
});
