/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSesDocument } from '../src/common/editor/ses-import.ts';
import { buildSesProject } from '../src/common/editor/ses-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createSesFixture } from './helpers/ses-fixture.ts';

function build(media = new Map([['1000', { frameCount: 48_000, channelCount: 2, sampleRate: 48_000 }]])) {
	let next = 0;
	return buildSesProject(parseSesDocument(createSesFixture()), {
		fileName: 'Archive.SES', media, createStableId: (prefix) => `${prefix}-${++next}`,
		stagedSourceIds: new Map([['1000', 'staged-voice']]),
	});
}

test('legacy session project keeps verified edit geometry and identifies the binary source in its report', () => {
	const plan = build();
	assert.equal(plan.title, 'Archive');
	assert.equal(plan.report.direction, 'import');
	assert.equal(plan.report.subject.format, 'ses');
	assert.match(plan.report.subject.container ?? '', /Cool Edit.*SES/u);
	assert.deepEqual(plan.media, [{ fileId: '1000', sourceId: 'staged-voice' }]);
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.title, 'Archive');
	assert.equal(project.tracks[0]?.name, 'Voice');
	assert.equal(project.tracks[0]?.gain, .5);
	assert.equal(project.clips[0]?.timelineStartFrame, 4800);
	assert.equal(project.clips[0]?.sourceStartFrame, 2400);
	assert.equal(project.clips[0]?.durationFrames, 9600);
	assert.ok(plan.report.items.some((item) => item.code === 'ses.project-imported'));
	assert.ok(plan.report.items.some((item) => item.severity === 'warning'));
	assert.ok(plan.report.items.every((item) => item.code.startsWith('ses.')));
	for (const disposition of ['preserved', 'converted', 'missing', 'omitted'] as const) {
		assert.equal(plan.report.counts[disposition], plan.report.items.filter((item) => item.disposition === disposition).length);
	}
});

test('missing legacy media is reported with its original reference and never creates playable sources', () => {
	const plan = build(new Map());
	assert.equal((plan.project.sources as unknown[]).length, 0);
	assert.equal((plan.project.clips as unknown[]).length, 0);
	assert.deepEqual(plan.media, []);
	const missing = plan.report.items.find((item) => item.code === 'ses.media-missing');
	assert.equal(missing?.disposition, 'missing');
	assert.match(String(missing?.data.path), /Voice\.wav$/u);
});

test('legacy sample-rate mismatches use SES wording and retain partial-import warnings', () => {
	const plan = build(new Map([['1000', { frameCount: 48_000, channelCount: 2, sampleRate: 44_100 }]]));
	assert.equal((plan.project.clips as unknown[]).length, 0);
	const mismatch = plan.report.items.find((item) => item.code === 'ses.sample-rate-mismatch');
	assert.match(mismatch?.message ?? '', /SES session/u);
	assert.doesNotMatch(mismatch?.message ?? '', /SESX/u);
	assert.ok(plan.report.counts.omitted >= 2);
});

test('legacy channel-balance changes are reported as conversions alongside omitted settings', () => {
	const session = parseSesDocument(createSesFixture({ tracks: [{ gain: .5, rightGain: .25 }] }));
	const plan = buildSesProject(session, {
		media: new Map([['1000', { frameCount: 48_000, channelCount: 2, sampleRate: 48_000 }]]),
		createStableId: (prefix) => `${prefix}-converted`,
	});
	assert.equal(plan.report.items.find((item) => item.code === 'ses.channel-gain-converted')?.disposition, 'converted');
	assert.equal(plan.report.counts.converted, 1);
	assert.ok(plan.report.counts.omitted > 0);
});
