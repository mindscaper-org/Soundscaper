/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEdlExport, type EdlEvent } from '../src/common/editor/edl-export.ts';
import { exportProjectEdl } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

// The maintained CMX3600 profile has a three-digit,999-event limit:
// https://help.rossvideo.com/acuity/Topics/Setup/LiveEDL/LiveEDL.html
for (const count of [999, 1_000]) test(`File Export EDL ${count === 999 ? 'saves999' : 'refuses1000'} native camera cuts`, async () => {
	const source = createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'camera.webm',
		mimeType: 'video/webm', contentSha256: 'ab'.repeat(32), sampleFrameCount: 1_600,
		sourceFrameCount: 1, frameRate: { num: 30, den: 1 }, width: 192, height: 108 });
	const clips = Array.from({ length: count }, (_, index) => ({ kind: 'video', id: `cut-${index}`,
		sourceId: source.id, sequenceId: 'main', sequenceStartFrame: index, sequenceFrameCount: 1,
		sourceInFrame: 0, sourceFrameCount: 1 }));
	const project = createFramescaperProject(PROFILE, { id: 'long-cut-list', sampleRate: 48_000,
		primarySequenceId: 'main', sources: [source], clips,
		tracks: [{ id: 'pictures', type: 'video', clipIds: clips.map(clip => clip.id) }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
	});
	const saved: Readonly<Record<string, unknown>>[] = [];
	const state: { deliveryReport?: unknown } = {};
	const run = exportProjectEdl({ getProject: () => project, state,
		fileService: { saveFile: request => { saved.push(request); return true; } } });
	if (count > 999) {
		await assert.rejects(run, /CMX3600.*999.*events.*OTIO|CMX3600.*999.*events.*FCPXML/u);
		assert.equal(saved.length, 0, 'an invalid cut list must not reach the save picker');
		assert.equal(state.deliveryReport, undefined, 'refused output must not claim that all events were preserved');
	} else {
		const result = await run; assert.ok(result);
		assert.equal(saved.length, 1); assert.equal(saved[0]?.purpose, 'interchange');
		const blob = saved[0]?.blob; assert.ok(blob instanceof Blob);
		assert.equal(await blob.text(), result.text);
		const lines = result.text.split('\n').filter(line => /^\d+ /u.test(line));
		assert.equal(lines.length, 999); assert.match(lines.at(-1) ?? '', /^999 /u);
		assert.equal(result.report.items.find(item => item.code === 'edl.events-preserved')?.data.events, 999);
	}
	assert.equal(project.clips.length, count);
});

test('the CMX event limit counts all event kinds together', () => {
	const events: EdlEvent[] = Array.from({ length: 1_000 }, (_, index) => ({
		reel: 'CAMERA', trackKind: index % 2 === 0 ? 'V' : 'A', sourceInFrames: 0,
		sourceOutFrames: 1, recordInFrames: index, recordOutFrames: index + 1,
	}));
	assert.throws(() => createEdlExport({ title: 'Mixed cuts', rate: { num: 30, den: 1 }, events }), /CMX3600.*999.*events/u);
});
