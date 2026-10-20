/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAvLinkedClipIds, collectLinkedTrackRippleTargets, deleteRange, keepRange, prepareRangeDeleteCommand, processTrackRange, replaceRange } from '../src/common/editor/commands/range-runtime.js';
import { commandFixture, countPropertyReads } from './helpers/round3-command-fixtures.ts';

void test('A/V range seeds resolve through one index with bounded identity reads', context => {
	const project = commandFixture();
	const reads = countPropertyReads(project.clips, 'id');
	assert.deepEqual(collectAvLinkedClipIds(project, project.tracks[0]!.clipIds), project.tracks[0]!.clipIds);
	context.diagnostic(`120 A/V-only range seeds: ${String(reads())} identity reads`);
	assert.ok(reads() <= 120 * 6, String(reads()));
});

void test('linked-track ripple visits track memberships, A/V relationships and owners once per closure', context => {
	const count = 80;
	const project = commandFixture(count * 2, count);
	for (let index = 0; index < count - 1; index += 1) {
		project.clips[index]!.avLinkId = `link-${String(index)}`;
		project.clips[index + count + 1]!.avLinkId = `link-${String(index)}`;
	}
	const membershipReads = countPropertyReads(project.tracks, 'clipIds');
	const linkReads = countPropertyReads(project.clips, 'avLinkId');
	const result = collectLinkedTrackRippleTargets(project, ['track-0']);
	assert.deepEqual(result.trackIds, project.tracks.map(track => track.id));
	assert.deepEqual(result.clipIds, project.clips.map(clip => clip.id));
	context.diagnostic(`80 linked tracks: ${String(membershipReads())} membership reads, ${String(linkReads())} relationship reads`);
	assert.ok(membershipReads() <= count * 7, String(membershipReads()));
	assert.ok(linkReads() <= count * 12, String(linkReads()));
});

void test('range editing resolves dense track material without per-clip project searches', context => {
	for (const operation of ['process', 'keep', 'replace']) {
		const project = commandFixture();
		const reads = countPropertyReads(project.clips, 'id');
		if (operation === 'process') processTrackRange(project, project.tracks[0], { startFrame: 20_000, endFrame: 20_100, durationFrames: 100 }, 'none', {});
		if (operation === 'keep') keepRange(project, { startFrame: 0, endFrame: 20_000, trackIds: ['track-0'] });
		if (operation === 'replace') replaceRange(project, { startFrame: 20_000, endFrame: 20_100, trackId: 'track-0', clipId: 'replacement', source: { id: 'replacement-source', storageKey: 'replacement-source', frameCount: 20, channelCount: 1 } });
		context.diagnostic(`${operation}: ${String(reads())} identity reads for 120 clips`);
		assert.ok(reads() <= 120 * 12, `${operation}: ${String(reads())}`);
		assert.equal(project.clips.length, operation === 'replace' ? 121 : 120);
	}
});

void test('range delete shares requested track resolution across staging and publication', context => {
	const project = commandFixture(120, 120);
	const command = prepareRangeDeleteCommand(project, { startFrame: 20_000, endFrame: 20_100, rippleMode: 'track' });
	const reads = countPropertyReads(project.tracks, 'id');
	deleteRange(project, command, 'track');
	context.diagnostic(`120 range tracks: ${String(reads())} track identity reads`);
	assert.ok(reads() <= 120 * 12, String(reads()));
});

