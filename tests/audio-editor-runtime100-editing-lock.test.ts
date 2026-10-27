/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackLockRelationshipReader } from '../src/common/editor/commands/track-lock-relationship-index.ts';
import { createTrackLockAdmission } from '../src/common/editor/commands/track-lock-admission.ts';
import { commandFixture } from './helpers/round3-command-fixtures.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

test('E25 protected track snapshots partition relationship members once per context', context => {
	const project = commandFixture(100, 100);
	for (const track of project.tracks) track.locked = true;
	for (let index = 0; index < project.clips.length; index++) {
		project.clips[index]!.groupId = `group-${Math.floor(index / 2)}`;
		project.clips[index]!.avLinkId = `link-${Math.floor(index / 2)}`;
	}
	let admission: ReturnType<typeof createTrackLockAdmission> | undefined;
	const count = visits('filter', () => { admission = createTrackLockAdmission(project, project); });
	assert.ok(admission);
	admission.afterCommand(project);
	context.diagnostic(`E25 relationship filter visits: ${count}`);
	assert.ok(count < 25000);
	project.clips[0]!.groupId = 'changed';
	assert.throws(() => admission!.afterCommand(project), /is locked/u);
});

test('locked relationship indexes do not invoke the mutable-owner getter', () => {
	const clips = [{ id: 'clip', groupId: 'group', avLinkId: 'link' }];
	let reads = 0;
	const project = { clips, get mutable() { reads++; return true; } };
	assert.equal(createTrackLockRelationshipReader(project, clips), null);
	assert.equal(reads, 0);
});
