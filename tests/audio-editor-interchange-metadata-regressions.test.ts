/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { encodeAiff } from '../src/common/editor/aiff.js';

function dawproject(arrangement: string): string {
	return '<Project version="1.0"><Transport><Tempo value="120" unit="bpm"/></Transport>'
		+ '<Structure><Track id="track" contentType="audio" name="Audio"><Channel id="channel" role="regular" audioChannels="1"/></Track></Structure>'
		+ `<Arrangement>${arrangement}</Arrangement></Project>`;
}

test('DAWproject import resolves source-out from the same origin as a fractional source-in', () => {
	const xml = dawproject('<Lanes timeUnit="seconds"><Lanes track="track"><Clips>'
		+ `<Clip time="0" duration="${5 / 44_100}" playStart="${1 / 44_100}" contentTimeUnit="seconds">`
		+ '<Audio duration="1" sampleRate="48000" channels="1"><File path="audio/take.wav"/></Audio></Clip></Clips></Lanes></Lanes>');
	let id = 0;
	const plan = buildDawprojectProject(parseDawprojectDocument(xml), { sampleRate: 44_100,
		media: new Map([['audio/take.wav', { sampleRate: 48_000, frameCount: 48_000, channelCount: 1 }]]), createStableId: prefix => `${prefix}-${id++}` });
	const clips = plan.project.clips;
	assert.ok(Array.isArray(clips));
	assert.equal(clips[0]?.sourceStartFrame, 1);
	assert.equal(clips[0]?.sourceDurationFrames, 6);
});

test('DAWproject marker comments survive import, native project construction, and re-export', () => {
	const xml = dawproject('<Markers timeUnit="seconds"><Marker time="0.5" name="Cue" comment="Bring vocals in"/></Markers>');
	let id = 0;
	const plan = buildDawprojectProject(parseDawprojectDocument(xml), { media: new Map(), createStableId: prefix => `${prefix}-${id++}` });
	const project = createCurrentAudioEditorProject(plan.project);
	const exported = createDawprojectExport({ project: { ...project } });
	const reopened = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	assert.equal(reopened.arrangement?.markers?.children[0]?.attributes.comment, 'Bring vocals in');
});

test('empty AIFF native descriptive chunks retain usable embedded ID3 metadata', async () => {
	const encoded = encodeAiff([new Float32Array(480)], { sampleRate: 48_000, bitDepth: 16,
		metadata: { title: 'ID3 title', artist: 'ID3 artist', comments: 'ID3 comment' } });
	assert.ok(encoded instanceof Uint8Array);
	const emptyChunks = new Uint8Array(24);
	for (const [index, name] of ['NAME', 'AUTH', 'ANNO'].entries()) emptyChunks.set(new TextEncoder().encode(name), index * 8);
	const header = encoded.slice(0, 12);
	new DataView(header.buffer).setUint32(4, encoded.byteLength - 8 + emptyChunks.byteLength);
	const inspected = await inspectImportedMediaMetadata(new Blob([header, emptyChunks, encoded.slice(12)], { type: 'audio/aiff' }));
	assert.equal(inspected.metadata.normalized?.title, 'ID3 title');
	assert.equal(inspected.metadata.normalized?.artist, 'ID3 artist');
	assert.equal(inspected.metadata.normalized?.comment, 'ID3 comment');
	assert.equal(inspected.metadata.raw?.NAME, '');
});
