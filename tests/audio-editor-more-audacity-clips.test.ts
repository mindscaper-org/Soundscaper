/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';

function ids() { let id = 0; return (prefix: string) => `${prefix}-${String(++id)}`; }
function nativeClip(offset: number) {
	return createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000 },
	], [createAudacityXmlNode('wavetrack', [], [createAudacityXmlNode('waveclip', [
		{ kind: 'attribute', name: 'offset', type: 'double', value: offset },
	], [createAudacityXmlNode('sequence', [
		{ kind: 'attribute', name: 'numsamples', type: 'long-long', value: 4 },
	], [createAudacityXmlNode('waveblock', [
		{ kind: 'attribute', name: 'start', type: 'long-long', value: 0 },
		{ kind: 'attribute', name: 'blockid', type: 'long-long', value: -4 },
	])])])])]);
}

test('MP01: Audacity import trims negative-time audio without moving hidden samples to timeline zero', async () => {
	const result = await decodeAudacityProjectTree(nativeClip(-2 / 48_000), async () => null,
		{ idFactory: ids(), planAudio: true });
	const clip = result.project.clips[0]!;
	assert.equal(clip.sourceStartFrame, 2);
	assert.equal(clip.sourceDurationFrames, 2);
	assert.equal(clip.durationFrames, 2);
	const before = await decodeAudacityProjectTree(nativeClip(-1), async () => null,
		{ idFactory: ids(), planAudio: true });
	assert.equal(before.project.clips.length, 0);
});

test('MP02: trimmed legacy AUP envelopes begin at the audible source position', async () => {
	const xml = `<project rate="48000"><wavetrack><waveclip trimleft="${String(2 / 48_000)}">
		<sequence numsamples="4"><waveblock start="0"><silentblockfile len="4"/></waveblock></sequence>
		<envelope><controlpoint t="0" val="0"/><controlpoint t="${String(2 / 48_000)}" val="1"/></envelope>
		</waveclip></wavetrack></project>`;
	const decoded = await decodeLegacyAupProject(new File([xml], 'trimmed.aup'), []);
	const result = convertLegacyAupToProject(decoded, { idFactory: ids() });
	assert.deepEqual(result.project.clips[0]!.envelope, [{ frame: 0, value: 1 }]);
});

test('MP08: Audacity 1.2 track-level sequences retain audio, placement, and envelope on import', async () => {
	const xml = `<project rate="48000"><wavetrack name="Old recording" offset="2">
		<sequence numsamples="4"><waveblock start="0"><silentblockfile len="4"/></waveblock></sequence>
		<envelope><controlpoint t="0" val="0.5"/></envelope>
		</wavetrack></project>`;
	const decoded = await decodeLegacyAupProject(new File([xml], 'old.aup'), []);
	const result = convertLegacyAupToProject(decoded, { idFactory: ids() });
	assert.equal(result.project.clips.length, 1);
	assert.equal(result.project.clips[0]!.timelineStartFrame, 96_000);
	assert.equal(result.project.clips[0]!.sourceDurationFrames, 4);
	assert.deepEqual(result.project.clips[0]!.envelope, [{ frame: 0, value: 0.5 }]);
});

test('MP12: legacy AUP import retains music metadata and custom tags independently of project filename', async () => {
	const decoded = await decodeLegacyAupProject(new File([`<project rate="48000"><tags>
		<tag name="TITLE" value="Song"/><tag name="ARTIST" value="Band"/><tag name="TRACKNUMBER" value="7"/>
		<tag name="COMMENT" value="Session notes"/><tag name="COPYRIGHT" value="Author"/>
		</tags></project>`], 'Filename.aup'), []);
	const project = convertLegacyAupToProject(decoded, { idFactory: ids(), title: 'Filename' }).project;
	assert.equal(project.metadata.artist, 'Band');
	assert.equal(project.metadata.title, 'Song');
	assert.equal(project.metadata.trackNumber, '7');
	assert.equal(project.metadata.comments, 'Session notes');
	assert.equal(project.metadata.tags.COPYRIGHT, 'Author');
	assert.equal(project.title, 'Filename');
});

test('MP13: legacy AUP restores the selected audio track rather than selecting another recording', async () => {
	const decoded = await decodeLegacyAupProject(new File([`<project rate="48000">
		<wavetrack name="First" isSelected="0"/><wavetrack name="Second" isSelected="1"/>
		</project>`], 'selected.aup'), []);
	const project = convertLegacyAupToProject(decoded, { idFactory: ids() }).project;
	assert.deepEqual(project.selection.trackIds, [project.tracks[1]!.id]);
});

test('MP14: a high-rate Audacity track spectral selection cannot prevent opening a lower-rate project', async () => {
	type XmlNode = { name: string; content: Array<{ kind: 'attribute'; name: string; type: string; value: number }
		| { kind: 'node'; node: XmlNode }> };
	const tree = nativeClip(0) as unknown as XmlNode;
	tree.content.push({ kind: 'attribute', name: 'selLow', type: 'double', value: 30_000 },
		{ kind: 'attribute', name: 'selHigh', type: 'double', value: 40_000 });
	const track = tree.content.find((entry) => entry.kind === 'node' && entry.node.name === 'wavetrack');
	assert.ok(track?.kind === 'node');
	track.node.content.push({ kind: 'attribute', name: 'rate', type: 'double', value: 96_000 });
	const decoded = await decodeAudacityProjectTree(tree, async () => null, { idFactory: ids(), planAudio: true });
	assert.equal(decoded.project.clips.length, 1);
	assert.equal(decoded.project.selection.frequencyRange, null);
});
