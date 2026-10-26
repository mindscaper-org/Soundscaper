/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { exportProjectFcpxml } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { parseXmlDocument, childElement } from '../src/common/editor/dawproject-xml.ts';

for (const [sampleRate, channels, rate, layout] of [
	[44_100, 1, '44.1k', 'mono'], [96_000, 2, '96k', 'stereo'],
	[192_000, 6, '192k', 'surround'], [48_000, 2, '48k', 'stereo'],
] as const) test(`public FCPXML delivery retains ${sampleRate}Hz/${channels} channel programme characteristics`, async () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Take.wav', sampleRate,
		frameCount: sampleRate, channelCount: 2 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Take', sourceStartFrame: 0,
		sourceDurationFrames: sampleRate, timelineStartFrame: sampleRate, durationFrames: sampleRate });
	const project = createSoundscaperProject({ id: `programme-${sampleRate}-${channels}`, sampleRate, masterChannels: channels,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
	assert.equal(validateSoundscaperProject(project), true);
	const before = structuredClone(project); const files: Blob[] = [];
	const result = await exportProjectFcpxml({ getProject: () => project, state: {}, fileService: { saveFile(request) {
		assert.equal(request.purpose, 'interchange'); assert.ok(request.blob instanceof Blob); files.push(request.blob);
	} } });
	assert.ok(result); assert.equal(files.length, 1); assert.equal(await files[0]!.text(), result.text);
	const root = parseXmlDocument(result.text, { maximumBytes: 1_000_000, maximumDepth: 16, maximumElements: 1000, maximumTextBytes: 1_000_000 }, { allowedSimpleDoctype: 'fcpxml' });
	const library = childElement(root, 'library'); assert.ok(library);
	const event = childElement(library, 'event'); assert.ok(event);
	const timeline = childElement(event, 'project'); assert.ok(timeline);
	const sequence = childElement(timeline, 'sequence'); assert.ok(sequence);
	// Apple FCPXML1.10: absent audioRate/audioLayout mean48kHz/stereo, not source geometry.
	assert.equal(sequence.attributes.audioRate ?? '48k', rate); assert.equal(sequence.attributes.audioLayout ?? 'stereo', layout);
	const spine = childElement(sequence, 'spine'); assert.ok(spine);
	const item = childElement(spine, 'asset-clip'); assert.ok(item);
	assert.equal(item.attributes.offset, '1s'); assert.equal(item.attributes.duration, '1s');
	assert.deepEqual(project, before);
});

for (const [sampleRate, channels, expectedRate, expectedLayout] of [
	[8_000, 2, '48k', 'stereo'], [48_000, 4, '48k', 'stereo'], [8_000, 4, '48k', 'stereo'],
] as const) test(`FCPXML reports unrepresentable ${sampleRate}Hz/${channels} channel timeline audio`, async () => {
	const project = createSoundscaperProject({ id: `unsupported-${sampleRate}-${channels}`, sampleRate, masterChannels: channels });
	assert.equal(validateSoundscaperProject(project), true);
	const result = await exportProjectFcpxml({ getProject: () => project, state: {} }); assert.ok(result);
	assert.match(result.text, new RegExp(`audioRate="${expectedRate}"`, 'u'));
	assert.match(result.text, new RegExp(`audioLayout="${expectedLayout}"`, 'u'));
	const item = result.report.items.find(({ code }) => code === 'fcpxml.sequence-audio-converted'); assert.ok(item);
	assert.equal(item.disposition, 'converted'); assert.equal(item.severity, 'warning');
	assert.deepEqual(item.data, { sourceSampleRate: sampleRate, sourceChannelCount: channels,
		sampleRate: 48_000, channelCount: 2 });
});
