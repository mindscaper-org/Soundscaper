/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { createDawprojectFolderBusReader, dawprojectAdditionalFolderBusIds, dawprojectStructureTree, readDawprojectMixerRouting } from '../src/common/editor/dawproject-export-context.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function folderProject(count: number) {
	const tracks = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, type: 'audio', clipIds: [] }));
	return { sampleRate: 48_000, tracks, clips: [], sources: [],
		trackFolders: Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({ id: `folder-${index}` }))),
		mixer: { groups: Array.from({ length: count }, (_, index) => ({ id: `folder-${index}`, name: `Group ${index}` })),
			sends: [], routes: Object.fromEntries(tracks.map(track => [track.id, { groupId: `folder-${count - 1}` }] as const)) } };
}

test('R08 export shares immutable foreign-folder reachability across structure and automation', context => {
	const results: ReturnType<typeof createDawprojectExport>[] = [];
	const count = visits('filter', () => { results.push(createDawprojectExport({ project: folderProject(200) })); });
	const result = results[0]!;
	const digest = createHash('sha256').update(result.projectXml).update(JSON.stringify(result.report)).digest('hex');
	context.diagnostic(`R08 filter visits: ${count}; exact XML/report digest: ${digest}`);
	assert.equal(digest, '585268d198d7436bb1095e35212fe5db535f8b1b6f6c2dfeb585bbfbb48faafd');
	assert.ok(count < 1800, `folder reachability repeated ${count} filter visits`);
	assert.deepEqual(result, createDawprojectExport({ project: structuredClone(folderProject(200)) }));
});

test('R08 foreign-folder readers preserve mutable ownership changes and live ID accessors', () => {
	const project = structuredClone(folderProject(3));
	const context = { project, routing: readDawprojectMixerRouting(project) };
	const structure = dawprojectStructureTree(project);
	const read = createDawprojectFolderBusReader(context, structure);
	assert.deepEqual(read(), dawprojectAdditionalFolderBusIds(context, structure));
	assert.equal(Reflect.set(project.trackFolders[2]!, 'id', 'changed'), true);
	assert.deepEqual(read(), dawprojectAdditionalFolderBusIds(context, structure));
	const immutable = folderProject(3);
	const current = { project: { ...immutable }, routing: readDawprojectMixerRouting(immutable) };
	const prepared = createDawprojectFolderBusReader(current, dawprojectStructureTree(immutable));
	assert.equal(prepared().has('folder-2'), true);
	current.project.trackFolders = Object.freeze([]);
	assert.equal(prepared().has('folder-2'), false);
	let reads = 0;
	const accessor = Object.freeze({ get id() { reads++; return 'folder-2'; } });
	const dynamic = { project: { ...immutable, trackFolders: Object.freeze([accessor]) }, routing: readDawprojectMixerRouting(immutable) };
	const dynamicRead = createDawprojectFolderBusReader(dynamic, dawprojectStructureTree(dynamic.project));
	const initialReads = reads;
	dynamicRead(); dynamicRead();
	assert.equal(reads - initialReads, 2);
});
