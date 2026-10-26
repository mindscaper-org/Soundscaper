/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSesxDocument } from '../src/common/editor/sesx-import.ts';
import { buildSesxProject } from '../src/common/editor/sesx-import-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

for (const { label, channels, map, omitted } of [
	{ label: 'left identity subset of stereo', channels: 2, map: [0], omitted: true },
	{ label: 'right subset of stereo', channels: 2, map: [1], omitted: true },
	{ label: 'complete stereo identity', channels: 2, map: [0, 1], omitted: false },
	{ label: 'complete mono identity', channels: 1, map: [0], omitted: false },
	{ label: 'swapped stereo', channels: 2, map: [1, 0], omitted: true },
	{ label: 'duplicated mono', channels: 1, map: [0, 0], omitted: true },
	{ label: 'implicit stereo', channels: 2, map: null, omitted: false },
]) test(`SESX ${label} map preserves existing unsupported-conversion accounting`, () => {
	const xml = `<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks><audioTrack>
	<trackAudioParameters audioChannelType="${map?.length === 1 ? 'mono' : 'stereo'}"/>
	<audioClip id="selected" fileID="recording" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800">
	${map ? `<channelMap>${map.map((sourceIndex, index) => `<channel index="${index}" sourceIndex="${sourceIndex}"/>`).join('')}</channelMap>` : ''}
	</audioClip></audioTrack></tracks></session><files><file id="recording" relativePath="Recording.wav"/></files></sesx>`;
	let serial = 0;
	const plan = buildSesxProject(parseSesxDocument(xml), { fileName: 'Selected channels.sesx', createStableId: prefix => `${prefix}-${++serial}`,
		media: new Map([['recording', { frameCount: 4800, sampleRate: 48000, channelCount: channels }]]) });
	const project = createSoundscaperProject(plan.project);
	assert.equal(project.clips.length, 1);
	assert.equal(project.sources[0]?.channelCount, channels, 'unsupported maps never rewrite the physical source');
	assert.equal(project.sources[0]?.frameCount, 4800);
	assert.equal(project.clips[0]?.sourceDurationFrames, 4800);
	const warnings = plan.report.items.filter(({ code }) => code === 'sesx.channel-map-omitted');
	assert.equal(warnings.length, omitted ? 1 : 0, 'identity cardinality is part of the authored map');
	if (omitted) {
		assert.equal(warnings[0]?.disposition, 'omitted');
		assert.equal(warnings[0]?.severity, 'warning');
		assert.equal(warnings[0]?.scope?.kind, 'clip');
	}
});
