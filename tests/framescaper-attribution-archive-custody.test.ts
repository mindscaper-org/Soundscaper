/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectAttributionReport, exportProjectAttributionCsv } from '../src/common/editor/project-attribution-report.ts';
import { framescaperAttributionCustody } from './helpers/framescaper-attribution-custody.ts';

for (const title of [false, true]) test(`image provenance and five-second use survive publication and Scape with generated title=${title}`, async context => {
	const fixture = await framescaperAttributionCustody(context, title);
	const before = structuredClone(fixture.project);
	const report = createProjectAttributionReport(fixture.runtime.projectForRuntimeConsumers(fixture.project));
	assert.deepEqual(fixture.project, before, 'reporting never rewrites authoritative sources');
	assert.equal(report.sources.length, 1, 'generated material does not appear as an imported credit');
	const source = report.sources[0]; assert.ok(source);
	assert.equal(source.sourceName, 'poster'); assert.equal(source.classification, 'imported'); assert.deepEqual(source.warnings, []);
	const origin = source.contributions[0]?.origin; assert.ok(origin?.kind === 'local-file');
	assert.equal(origin.originalFileName, 'poster.png'); assert.equal(origin.mimeType, 'image/png'); assert.equal(origin.byteLength, fixture.original.byteLength);
	const use = source.uses[0]; assert.ok(use?.kind === 'clip');
	assert.equal(use.sequenceId, 'main'); assert.equal(use.trackId, 'pictures'); assert.equal(use.startFrame, 0); assert.equal(use.endFrame, 240_000);
	const csv = exportProjectAttributionCsv(report);
	assert.ok(csv.includes('use_start_timecode')); assert.ok(csv.includes('"poster"')); assert.ok(csv.includes('00:00:05.000'));
	assert.ok(csv.includes('poster.png')); assert.ok(csv.includes('local-file')); assert.ok(!csv.includes('predates provenance tracking')); assert.ok(!csv.includes('"Title"'));
});
