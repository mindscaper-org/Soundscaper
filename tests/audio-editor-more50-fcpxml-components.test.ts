/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFcpxmlTimeline } from '../src/common/editor/timeline-interchange-fcpxml-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';

const HEAD = '<fcpxml version="1.7"><resources><format id="f" frameDuration="1/25s"/><asset id="a" name="Programme" src="programme.wav" start="0s" duration="20s" hasAudio="1" hasVideo="0"/></resources><project><sequence format="f" duration="10s"><spine>';
const TAIL = '</spine></sequence></project></fcpxml>';

test('FCPXML connected secondary storylines retain their offset and serial cuts', () => {
	const document = parseFcpxmlTimeline(HEAD + '<gap offset="0s" start="5s" duration="10s"><spine lane="-1" offset="6s">'
		+ '<asset-clip ref="a" offset="0s" start="2s" duration="2s"/><asset-clip ref="a" offset="2s" start="4s" duration="1s"/></spine></gap>' + TAIL);
	assert.equal(document.tracks.length, 1);
	assert.deepEqual(document.tracks[0]!.clips.map(clip => [clip.start, clip.duration, clip.sourceStart]), [
		[{ num: 1, den: 1 }, { num: 2, den: 1 }, { num: 2, den: 1 }],
		[{ num: 3, den: 1 }, { num: 1, den: 1 }, { num: 4, den: 1 }],
	]);
	assert.equal(document.issues.length, 0);
});

for (const attribute of ['enabled', 'active']) test(`FCPXML ${attribute}=0 components remain silent through native assembly`, () => {
	const document = parseFcpxmlTimeline(HEAD + `<asset-clip ref="a" duration="2s"><audio-channel-source srcCh="1" ${attribute}="0"/></asset-clip>` + TAIL);
	assert.equal(document.tracks[0]!.clips[0]!.muted, true);
	let ordinal = 0;
	const native = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` }).project;
	assert.equal((native.clips as readonly { gain?: number }[])[0]!.gain, 0);
});

test('FCPXML mixed component selection is disclosed and never re-enables disabled channels', () => {
	const document = parseFcpxmlTimeline(HEAD + '<asset-clip ref="a" duration="2s"><audio-channel-source srcCh="1" enabled="0"/>'
		+ '<audio-channel-source srcCh="2"/></asset-clip>' + TAIL);
	assert.equal(document.tracks.flatMap(track => track.clips).length, 0);
	assert.ok(document.issues.some(issue => issue.code === 'fcpxml.audio-components-omitted'));
});

test('FCPXML parent primary-layout controls apply to contained audio', () => {
	const document = parseFcpxmlTimeline(HEAD + '<clip duration="2s"><audio ref="a" duration="2s"/>'
		+ '<audio-channel-source srcCh="1" enabled="0"/></clip>' + TAIL);
	assert.equal(document.tracks[0]!.clips[0]!.muted, true);
});
