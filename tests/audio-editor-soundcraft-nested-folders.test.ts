/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { soundcraftNestedFolderSession } from './helpers/soundcraft-folder-import-fixture.ts';

test('opening nested SoundCraft folders builds a contiguous track tree', () => {
	let ordinal = 0;
	const document = parseTimelineInterchange('Folders.scraft', JSON.stringify(soundcraftNestedFolderSession()));
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	const parent = project.trackFolders.find(folder => folder.name === 'Parent')!;
	const child = project.trackFolders.find(folder => folder.name === 'Child')!;
	assert.ok(parent); assert.ok(child);
	const nodes = project.sequences[0]!.trackNodes;
	assert.equal(nodes.find(node => node.id === child.id)?.parentFolderId, parent.id);
	const childTrack = project.tracks.find(track => track.name === 'Child audio')!;
	assert.equal(nodes.find(node => node.id === childTrack.id)?.parentFolderId, child.id);
});

test('nested SoundCraft folder audio passes through its parent fader', () => {
	let ordinal = 0;
	const input = soundcraftNestedFolderSession();
	const document = parseTimelineInterchange('Folders.scraft', JSON.stringify({ ...input,
		tracks: [input.tracks[0], input.tracks[2], input.tracks[3], input.tracks[1]] }));
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
	assert.doesNotThrow(() => createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer }));
	const parentId = plan.production.mixer.groups.find(bus => bus.name === 'Parent')!.id;
	const childId = plan.production.mixer.groups.find(bus => bus.name === 'Child')!.id;
	const output = plan.production.mixer.edges.find(edge => edge.kind === 'assignment' && edge.source.kind === 'mixer-node' && edge.source.id === childId);
	assert.deepEqual(output?.destination, { kind: 'mixer-node', id: parentId });
});
