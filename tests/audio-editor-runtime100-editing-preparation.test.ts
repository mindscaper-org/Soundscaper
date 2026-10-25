/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePunchCommand, prepareRangeDeleteCommand, prepareRangeReplacementCommand } from '../src/common/editor/commands/range-runtime.js';
import { prepareOverwriteClipCommand } from '../src/common/editor/commands/clip-transform-runtime.js';
import { prepareThreePointEditCommand } from '../src/common/editor/commands/three-point-edit-runtime.js';
import { commandFixture } from './helpers/round3-command-fixtures.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function fixture() {
	const project = commandFixture(200);
	for (const clip of project.clips) Object.freeze(clip);
	Object.freeze(project.clips);
	return project;
}
function ids() { let next = 0; return (prefix: string) => `${prefix}-generated-${next++}`; }
const range = { trackId: 'track-0', startFrame: 5, endFrame: 10 };
const operations = [
	['E07', 'range deletion preparation', (project: ReturnType<typeof fixture>) => prepareRangeDeleteCommand(project, { ...range, trackIds: ['track-0'] }, ids())],
	['E08', 'punch replacement preparation', (project: ReturnType<typeof fixture>) => preparePunchCommand(project, { ...range, sourceId: 'source' }, ids())],
	['E09', 'processed range replacement preparation', (project: ReturnType<typeof fixture>) => prepareRangeReplacementCommand(project, { ...range, source: { ...project.sources[0], id: 'processed' } }, ids())],
	['E10', 'single clip overwrite preparation', (project: ReturnType<typeof fixture>) => prepareOverwriteClipCommand(project, 'clip-199', { changes: { timelineStartFrame: 5 } }, ids())],
	['E11', 'three-point overwrite preparation', (project: ReturnType<typeof fixture>) => prepareThreePointEditCommand(project, { ...range, placements: [{ trackId: 'track-0', sourceId: 'source', sourceCount: 5 }] }, ids())],
] as const;
for (const [id, name, invoke] of operations) test(`${id} ${name} indexes immutable clip identities for one invocation`, context => {
	const project = fixture(), before = JSON.stringify(project);
	let command: ReturnType<typeof invoke> | undefined;
	const count = visits('find', () => { command = invoke(project); });
	context.diagnostic(`${id} find predicate visits: ${count}`);
	assert.ok(command);
	assert.equal(JSON.stringify(project), before);
	assert.ok(count < 1000, `${id} ${count}`);
	const mutable = commandFixture(200);
	assert.deepEqual(command, invoke(mutable));
});
