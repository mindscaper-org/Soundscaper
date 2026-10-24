/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planClipSpreadsheetEdits, findMissingClipSpreadsheetEditSources } from '../src/common/editor/clip-spreadsheet.ts';

function source(id: string, name: string) { return { id, name, sampleRate: 48_000, frameCount: 480_000, channelCount: 1 }; }
function fixture(sources = [source('original', 'Original.wav')], count = 1) {
	const clips = Array.from({ length: count }, (_, index) => ({ id: `clip-${index}`, kind: 'audio', title: 'Clip', sourceId: 'original', timelineStartFrame: index * 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000, trimStartFrames: 0, trimEndFrames: 432_000, pitchCents: 0, speedRatio: 1, gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, inverted: false, renderCacheRevision: 0, envelope: [] }));
	return { sampleRate: 48_000, sources, clips, tracks: [{ id: 'track', name: 'Track', type: 'audio', clipIds: clips.map(clip => clip.id) }] };
}

test('source-name pastes build one ambiguity index for the whole spreadsheet plan', context => {
	let nameReads = 0;
	const count = 400;
	const sources = [source('original', 'Original.wav'), ...Array.from({ length: count }, (_, index) => ({ ...source(`source-${index}`, ''), get name() { nameReads++; return `Source ${index}.wav`; } }))];
	const project = fixture(sources, 120);
	const command = planClipSpreadsheetEdits(project, project.clips.map(clip => ({ clipId: clip.id, column: 'source', value: 'Source 399.wav' })));
	assert.ok(command);
	context.diagnostic(`${nameReads} source-name reads for ${project.clips.length} edits and ${count} sources`);
	assert.ok(nameReads <= count * 2, `${nameReads} source-name reads for ${project.clips.length} edits and ${count} sources`);
});

test('source lookup preserves exact spelling before trimming, ID authority, ambiguity, and later source-ID replacements', () => {
	const project = fixture([source('original', 'Original.wav'), source('target', 'Target.wav'), source('exact-name', ' target '), source('obsolete', 'Old.wav')]);
	const edit = (value: string) => [{ clipId: 'clip-0', column: 'source' as const, value }];
	const command = planClipSpreadsheetEdits(project, edit(' target '));
	assert.ok(command?.type === 'clip/transform-many');
	assert.equal(command.transforms[0]?.changes.sourceId, 'exact-name');
	assert.equal(planClipSpreadsheetEdits(project, edit('original')), null);
	assert.deepEqual(findMissingClipSpreadsheetEditSources(project, edit(' absent ')), [' absent ']);
	assert.throws(() => planClipSpreadsheetEdits(project, edit(' target '), { additionalSources: [source('duplicate-name', ' target ')] }), /ambiguous/);
	assert.deepEqual(findMissingClipSpreadsheetEditSources(project, edit('Old.wav')), []);
	assert.throws(() => planClipSpreadsheetEdits(project, edit('Old.wav'), { additionalSources: [source('obsolete', 'New.wav')] }), /missing/);
	project.sources[2]!.name = 'renamed';
	const changed = planClipSpreadsheetEdits(project, edit(' target '));
	assert.ok(changed?.type === 'clip/transform-many');
	assert.equal(changed.transforms[0]?.changes.sourceId, 'target');
});

test('ID-only source edits do not read unrelated source names', () => {
	const project = fixture([source('original', 'Original.wav'), { ...source('unrelated', ''), get name(): string { throw new Error('Unrelated name must stay unread.'); } }]);
	assert.equal(planClipSpreadsheetEdits(project, [{ clipId: 'clip-0', column: 'source', value: 'original' }]), null);
});
