/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { resolveSequenceTimingView } from '../src/common/editor/sequence-timing-model.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { readWithReference } from './helpers/interchange-reference.ts';

for (const negative of [true, false]) test(`native OTIO delivery preserves an authored ${negative ? 'negative' : 'positive'} sequence origin`, async () => {
	const initial = createFramescaperProject(PROFILE, { id: 'otio-origin', sampleRate: 48_000,
		sources: [createVideoSource({ id: 'camera', storageKey: 'camera.webm', contentSha256: 'ab'.repeat(32),
			sourceFrameCount: 60, sampleFrameCount: 96_000, frameRate: { num: 30, den: 1 }, width: 16, height: 16 })],
		clips: [{ kind: 'video', id: 'shot', sourceId: 'camera', sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['shot'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture'] }], primarySequenceId: 'main',
	});
	const project = applyFramescaperProjectCommand(PROFILE, initial, { type: 'sequence/update', sequenceId: 'main',
		changes: { startTimecode: { negative, hours: 0, minutes: 0, seconds: 10, frames: 0 } } });
	assert.equal(resolveSequenceTimingView(project).startFrameCount, negative ? -300 : 300);
	const files: Blob[] = [];
	const delivered = await exportProjectOtio({ getProject: () => project, state: {}, fileService: { saveFile(request) {
		assert.equal(request.purpose, 'interchange'); assert.ok(request.blob instanceof Blob); files.push(request.blob);
	} } });
	assert.ok(delivered); assert.equal(files.length, 1); assert.equal(await files[0]!.text(), delivered.text);
	const [timeline] = readWithReference(delivered.text, 'otio_json', {}, '.otio'); assert.ok(timeline);
	assert.equal(timeline.globalStartValue, negative ? -300 : 300); assert.equal(timeline.globalStartRate, 30);
	const item = timeline.tracks[0]?.items[0]; assert.ok(item);
	assert.equal(item.startValue, 0); assert.equal(item.durationValue, 30, 'sequence origins do not shift media in-points or duration');
});

for (const origin of [NaN, Infinity, -Infinity, 1.5, -1.5, -Number.MAX_SAFE_INTEGER - 1]) test(`OTIO refuses an unrepresentable origin ${origin}`, () => {
	assert.throws(() => createOtioExport({ project: { sampleRate: 48_000 }, sequenceRate: { num: 30, den: 1 }, startFrameCount: origin }), /whole number/u);
});
