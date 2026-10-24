/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { trackHierarchyPlacement } from '../src/common/editor/track-hierarchy-placement.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

test('E15 derived-track placement counts siblings without cloning preceding nodes', () => {
	const nodes = Array.from({ length: 300 }, (_, index) => ({ kind: 'track' as const, id: `track-${index}`, parentFolderId: index % 2 ? 'folder' : null }));
	const project = { primarySequenceId: 'main', sequences: [{ id: 'other', trackNodes: nodes }], tracks: nodes, trackFolders: [] };
	let placement: ReturnType<typeof trackHierarchyPlacement> = {};
	const count = visits('slice', () => { placement = trackHierarchyPlacement(project, 'track-298', 1); });
	assert.deepEqual(placement, { sequenceId: 'other', index: 299, parentFolderId: null, parentIndex: 150 });
	assert.equal(count, 0);
	assert.deepEqual(trackHierarchyPlacement(project, 'track-298', 1, false), { sequenceId: 'other' });
	assert.deepEqual(trackHierarchyPlacement(project, 'missing'), {});
});
