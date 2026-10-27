/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';

test('DAWproject export reuses source and clip indexes for every track width', () => {
	let reads = 0;
	const count = 160;
	const clips = Array.from({ length: count }, (_, index) => ({
		get id() { reads++; return `c${index}`; }, sourceId: `s${index}`, kind: 'audio',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 10, durationFrames: 10,
	}));
	const sources = Array.from({ length: count }, (_, index) => ({
		get id() { reads++; return `s${index}`; }, channelCount: index % 2 + 1, sampleRate: 48_000,
	}));
	const tracks = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, type: 'audio', clipIds: [`c${index}`] }));
	const project = { id: 'widths', sampleRate: 48_000, tracks, clips, sources };
	const result = createDawprojectExport({ project });
	assert.equal(result.media.length, count);
	assert.ok(reads < count * 20, `source/clip identity reads: ${reads}`);
	assert.match(result.projectXml, /audioChannels="1"/u);
	assert.match(result.projectXml, /audioChannels="2"/u);
	const changed = createDawprojectExport({ project: { ...project, sources: sources.map(source => ({ ...source, channelCount: 4 })) } });
	assert.match(changed.projectXml, /audioChannels="4"/u);
});
