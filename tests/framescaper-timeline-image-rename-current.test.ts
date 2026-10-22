/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1,
	type FramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { createImageDevelopHandoffProvenanceCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-current-v1.ts';
import { FRAMESCAPER_RAW_DECODER_IDENTITY_V1 } from '../src/common/editor/timeline-image-raw-receipt-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { applyFramescaperProjectCommand, prepareFramescaperVideoTransitionAllocations } from '../src/framescaper/editor-project-commands.ts';
import { prepareTimelineImageRenameCommand } from '../src/framescaper/editor-timeline-image-rename-command.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../src/framescaper/editor-project-assistance-foundation.ts';
import { editableImageFixture, PROFILE } from './helpers/framescaper-editable-image-current-fixture.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { hdrFrameFixtureCurrentV1 } from './helpers/lightscaper-hdr-frame-current-fixture.ts';

const NOW = '2026-10-22T00:00:00.000Z';

/** These scalar fixtures test command metadata ownership, not native RAW body proof. */
function editableSources() {
	const f = editableImageFixture({ cube: true, crop: false });
	const develop = replaceImageDevelopRepairSpotsV1(f.source.develop, { schemaVersion: 1, spots: [{
		id: 'retained-heal', mode: 'heal', enabled: false, target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius: .1, feather: .5, opacity: .75,
	}] });
	const origin = { ...f.source.provenance.origin, schemaVersion: 3 };
	const third = normalizeFramescaperImageSourceCurrentV1({ ...f.source, schemaVersion: 3, develop,
		provenance: createImageDevelopHandoffProvenanceCurrentV1({ develop, original: f.source.provenance.original, origin }) });
	const original = { ...f.source.original, fileName: 'Native.dng', mimeType: 'image/x-adobe-dng', recognizedFormat: 'dng' };
	const fourth = normalizeFramescaperImageSourceCurrentV1({ ...third, schemaVersion: 4, original,
		provenance: createImageDevelopHandoffProvenanceCurrentV1({ develop, origin,
			original: { ...f.source.provenance.original, exactName: original.fileName } }),
		raw: { schemaVersion: 1, decoder: FRAMESCAPER_RAW_DECODER_IDENTITY_V1, rawFlip: 0, pixelEncoding: 'rgba16be', pixelsSha256: 'a'.repeat(64),
			descriptor: { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' } } });
	return [f.source, third, fourth];
}

function projectFor(source: Readonly<FramescaperImageSourceCurrentV1>) {
	const f = editableImageFixture({ crop: false }), clip = { ...f.clip, sourceId: source.id };
	return applyFramescaperProjectCommand(PROFILE, f.baseProject(), { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip,
			placement: { scope: 'timeline', trackId: 'video-track' } },
	] }, { now: NOW });
}

for (const version of [1, 2, 3, 4, 5] as const) test(`Current Source${version} rename preserves complete authority and unrelated commands`, async () => {
	const source = version === 1 ? createFramescaperBaselineImageFixture({ imageOnly: true }).source
		: version === 5 ? (await hdrFrameFixtureCurrentV1()).source : editableSources()[version - 2]!;
	assert.equal(source.schemaVersion, version);
	const project = projectFor(source), before = structuredClone(project);
	const command = { type: 'selection/set' as const, startFrame: 0, endFrame: 0, clipIds: ['image-clip'], trackIds: ['video-track'] };
	const allocation = prepareFramescaperVideoTransitionAllocations(PROFILE, project, command, () => assert.fail('No transition allocation is needed.'));
	assert.deepEqual(allocation, command);
	assert.deepEqual(applyFramescaperProjectCommand(PROFILE, project, allocation, { now: NOW }).sources, before.sources);
	const rename = { type: 'clip/update' as const, clipId: 'image-clip', changes: { title: 'Renamed image' } };
	const prepared = prepareTimelineImageRenameCommand(framescaperProjectTimelineImageFoundationShapeAssistance(project), rename);
	assert.deepEqual(prepared, { type: 'image-source/set', sourceId: source.id, expectedSource: source, source: { ...source, name: 'Renamed image' } });
	const renamed = applyFramescaperProjectCommand(PROFILE, project, rename, { now: NOW });
	assert.deepEqual(renamed.sources, [{ ...source, name: 'Renamed image' }]);
	assert.deepEqual(renamed.clips, before.clips);
	assert.deepEqual(framescaperImageSourceResourceReferencesCurrentV1(renamed.sources[0]), framescaperImageSourceResourceReferencesCurrentV1(source));
	assert.deepEqual(project, before);
	assert.throws(() => applyFramescaperProjectCommand(PROFILE, renamed, prepared, { now: NOW }), /stale/u);
	assert.deepEqual(renamed.sources, [{ ...source, name: 'Renamed image' }]);
});

test('nested sequential Current renames retain exact expected-source CAS without projecting recipe or resources', () => {
	const source = editableSources()[1]!, project = projectFor(source), before = structuredClone(project);
	const first = { ...source, name: 'First title' }, second = { ...source, name: 'Second title' };
	const prepared = prepareTimelineImageRenameCommand(framescaperProjectTimelineImageFoundationShapeAssistance(project), { type: 'batch', commands: [
		{ type: 'clip/update', clipId: 'image-clip', changes: { title: first.name } },
		{ type: 'batch', commands: [{ type: 'clip/update', clipId: 'image-clip', changes: { title: second.name } }] },
	] });
	assert.deepEqual(prepared, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: source, source: first },
		{ type: 'batch', commands: [{ type: 'image-source/set', sourceId: source.id, expectedSource: first, source: second }] },
	] });
	const renamed = applyFramescaperProjectCommand(PROFILE, project, prepared, { now: NOW });
	assert.deepEqual(renamed.sources, [second]); assert.deepEqual(project, before);
});

test('Current rename keeps unknown-version and closed-own metadata refusal without invoking source accessors', () => {
	const source = editableSources()[1]!, project = projectFor(source), before = structuredClone(project);
	const foundation = framescaperProjectTimelineImageFoundationShapeAssistance(project);
	const rename = { type: 'clip/update' as const, clipId: 'image-clip', changes: { title: 'Refused' } };
	let reads = 0;
	const accessor = Object.defineProperty({ ...source }, 'develop', { enumerable: true, get() { reads++; return source.schemaVersion === 1 ? null : source.develop; } });
	for (const [label, bad] of [['future-version', { ...source, schemaVersion: 6 }],
		['foreign-field', { ...source, foreignAuthority: true }], ['accessor', accessor]] as const) {
		// Deliberately violate only this preparer's source input; outer projections are not the subject.
		const malformed = { ...foundation, sources: [bad] } as unknown as typeof foundation;
		assert.throws(() => prepareTimelineImageRenameCommand(malformed, rename), label);
	}
	assert.equal(reads, 0); assert.deepEqual(project, before);
});
