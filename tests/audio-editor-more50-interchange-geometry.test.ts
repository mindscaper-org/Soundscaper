/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOmfExport } from '../src/common/editor/omf-export.ts';
import { readOmfBento } from '../src/common/editor/omf-bento.ts';
import { parseOmfDocument } from '../src/common/editor/omf-import.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { parseOtioTimeline } from '../src/common/editor/timeline-interchange-otio-import.ts';
import { parseFcpxmlTimeline } from '../src/common/editor/timeline-interchange-fcpxml-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';

test('OMF keeps sequential mono and stereo cuts in separate width-preserving lanes', () => {
	const sources = [{ id: 'mono', kind: 'audio', name: 'mono.wav', channelCount: 1 }, { id: 'stereo', kind: 'audio', name: 'stereo.wav', channelCount: 2 }]
		.map(source => ({ ...source, sampleRate: 48_000, frameCount: 48_000 }));
	const clips = ['mono', 'stereo', 'mono'].map((sourceId, index) => ({ id: `clip-${index}`, kind: 'audio', sourceId,
		timelineStartFrame: index * 24_000, durationFrames: 24_000, sourceStartFrame: 0 }));
	const result = createOmfExport({ project: { title: 'Widths', sampleRate: 48_000, sources, clips,
		tracks: [{ id: 'track', type: 'audio', clipIds: clips.map(clip => clip.id) }] } });
	const imported = parseOmfDocument(result.bytes);
	assert.equal(imported.tracks.length, 2);
	assert.deepEqual(imported.tracks.map(track => track.clips.map(clip => clip.start.num / clip.start.den)), [[0, 1], [.5]]);
	assert.ok(result.report.items.some(item => item.code === 'omf.mixed-channel-track-split'));
	assert.equal(result.report.items.some(item => item.code === 'omf.overlapping-track-split'), false);
	const file = readOmfBento(result.bytes);
	const composition = file.refs(1, 'OMFI:HEAD:Mobs', true).find(id => file.text(id, 'OMFI:OOBJ:ObjClass') === 'CMOB')!;
	const dataKind = (id: number) => file.text(file.refs(id, 'OMFI:CPNT:DataKind')[0]!, 'OMFI:DDEF:DataKindID');
	const kinds: string[] = [];
	for (const slot of file.refs(composition, 'OMFI:MOBJ:Slots', true)) {
		const sequence = file.refs(slot, 'OMFI:MSLT:Segment')[0]!;
		kinds.push(dataKind(sequence));
		for (const component of file.refs(sequence, 'OMFI:SEQU:Components', true)) assert.equal(dataKind(component), dataKind(sequence));
	}
	assert.deepEqual(kinds, ['omfi:data:Sound', 'omfi:data:StereoSound']);
});

function pictureProject() {
	const sources = ['Foreground', 'Background'].map(id => ({ id, kind: 'video', name: id + '.mp4', storageKey: id,
		sampleRate: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 320, height: 180 }));
	const clips = sources.map(source => ({ id: source.id + '-clip', kind: 'video', sourceId: source.id, title: source.name,
		timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, sourceInFrame: 0, sourceFrameCount: 25 }));
	const tracks = sources.map(source => ({ id: source.id + '-track', type: 'video', name: source.id, clipIds: [source.id + '-clip'] }));
	return { title: 'Picture stack', sampleRate: 48_000, sources, clips, tracks };
}

type Data = Readonly<Record<string, unknown>>;
function records(value: unknown): Data[] {
	assert.ok(Array.isArray(value));
	return value.map((item: unknown) => { assert.ok(item && typeof item === 'object'); return item as Data; });
}

for (const format of ['otio', 'fcpxml'] as const) test(`${format} roundtrip preserves native foreground-first picture order`, () => {
	const request = { project: pictureProject(), sequenceRate: { num: 25, den: 1 } };
	const document = format === 'otio' ? parseOtioTimeline(createOtioExport(request).text) : parseFcpxmlTimeline(createFcpxmlExport(request).text);
	let ordinal = 0;
	const imported = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` }).project;
	const clips = records(imported.clips), sources = records(imported.sources);
	const names = records(imported.tracks).map(track => {
		assert.ok(Array.isArray(track.clipIds));
		const firstId: unknown = track.clipIds[0];
		const clip = clips.find(clip => clip.id === firstId)!;
		return String(sources.find(source => source.id === clip.sourceId)!.name).replace(/\.mp4$/u, '');
	});
	assert.deepEqual(names, ['Foreground', 'Background']);
});

test('FCPXML orders connected picture lanes by layer rather than XML encounter order', () => {
	const assets = ['Base', 'Middle', 'Top'].map((name, index) => `<asset id="a${index}" name="${name}" src="${name}.mp4" hasVideo="1" hasAudio="0" format="f" duration="2s"/>`).join('');
	const xml = `<fcpxml version="1.7"><resources><format id="f" frameDuration="1/25s"/>${assets}</resources><project><sequence format="f" duration="2s"><spine>`
		+ '<asset-clip ref="a0" duration="2s"><asset-clip ref="a2" lane="2" offset="0s" duration="2s"/><asset-clip ref="a1" lane="1" offset="0s" duration="2s"/></asset-clip>'
		+ '</spine></sequence></project></fcpxml>';
	const document = parseFcpxmlTimeline(xml);
	assert.deepEqual(document.tracks.filter(track => track.kind === 'video').map(track => track.clips[0]!.name), ['Top', 'Middle', 'Base']);
});
