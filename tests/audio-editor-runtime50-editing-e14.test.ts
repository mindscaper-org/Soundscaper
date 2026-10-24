/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sequenceTrackMembers } from '../src/common/editor/sequence-track-members.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

test('E14 sequence membership avoids projecting nonowning sequence node lists', () => {
	const project = { sequences: Array.from({ length: 80 }, (_, index) => ({ trackNodes: Array.from({ length: 80 }, (_, item) => ({ kind: item % 2 ? 'folder' : 'track', id: `${index}-${item}` })) })) };
	let members: ReadonlySet<string> | null = null;
	const count = visits('filter', () => { members = sequenceTrackMembers(project, '79-0'); });
	assert.equal(members?.size, 40);
	assert.ok(members?.has('79-78'));
	assert.equal(count, 0);
	assert.equal(sequenceTrackMembers({ sequences: [{ trackIds: ['old'], trackNodes: [] }] }, 'old'), null);
	assert.equal(sequenceTrackMembers(project, null), null);
});
