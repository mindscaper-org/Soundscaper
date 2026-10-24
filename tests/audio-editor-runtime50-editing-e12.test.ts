/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateTrackAdmCommands } from '../src/common/editor/derived-track-adm.ts';
import { normalizeAdmProjectMetadata } from '../src/common/editor/adm-project-metadata.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

test('E12 ADM duplication indexes authored assignments by source strip', context => {
	const copies = Array.from({ length: 100 }, (_, index) => ({ sourceTrackId: `source-${index}`, targetTrackId: `target-${index}` }));
	const adm = { mode: 'authored', programme: { name: 'Programme', language: 'eng' }, content: { name: 'Content', language: 'eng' }, bed: { name: 'Bed', layout: 'stereo', assignments: copies.map(copy => ({ stripKind: 'track', stripId: copy.sourceTrackId, sourceChannel: 0, bedChannel: 'L' })) } };
	const project = { metadata: { adm } };
	const before = structuredClone(project);
	let commands: ReturnType<typeof duplicateTrackAdmCommands> = [];
	const count = visits('filter', () => { commands = duplicateTrackAdmCommands(project, copies, () => 'unused'); });
	assert.ok(count <= 200, `ADM assignment filter visits ${count}`);
	context.diagnostic(`E12 ADM filter visits: ${count}`);
	const command = commands[0]!;
	assert.equal(command.type, 'metadata/update');
	if (command.type !== 'metadata/update') throw new Error('Expected metadata update');
	const result = normalizeAdmProjectMetadata(command.changes.adm);
	assert.equal(result?.mode, 'authored');
	if (result?.mode !== 'authored') throw new Error('Expected authored ADM');
	assert.equal(result.bed.assignments.length, 200);
	assert.equal(result.bed.assignments[199]!.stripId, 'target-99');
	assert.deepEqual(project, before);
	assert.deepEqual(duplicateTrackAdmCommands({}, copies, () => 'unused'), []);
	assert.deepEqual(duplicateTrackAdmCommands(project, [{ sourceTrackId: 'missing', targetTrackId: 'new' }], () => 'unused'), []);
});
