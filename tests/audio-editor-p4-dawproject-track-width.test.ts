/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { audioTrackChannelCount } from '../src/common/editor/project-audio-factory.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const [declared, physical] of [[1, 2], [2, 2], [4, 2], [null, 2], [1, 1], [null, 1]] as const) test(`DAWproject File Open discloses declared width ${String(declared)} over ${String(physical)} source channels`, async () => {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Track widths</Title></MetaData>',
		projectXml: `<Project version="1.0"><Application name="Track widths" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular" ${declared === null ? '' : `audioChannels="${String(declared)}"`}/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1"><Audio channels="${String(physical)}" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/voice.wav', blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)].slice(0, physical), { sampleRate: 48_000, float: true }))]) }] });
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Track widths.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	const source = opened.project.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.channelCount, physical, 'physical source channels remain available');
	const tracks = opened.project.tracks as readonly { id: string; clipIds: readonly string[] }[];
	const track = tracks[0]; assert.ok(track);
	assert.equal(audioTrackChannelCount(opened.project, track), physical);
	const report = opened.report as DeliveryReport;
	const changes = report.items.filter(item => item.code === 'dawproject.track-channel-width-converted');
	const changed = declared !== null && declared !== physical;
	assert.equal(report.counts.converted, changed ? 1 : 0);
	if (changed) {
		assert.equal(changes.length, 1, 'a changed authored mixer width must be visible in the import report');
		assert.equal(changes[0]?.severity, 'warning'); assert.equal(changes[0]?.disposition, 'converted');
		assert.deepEqual(changes[0]?.scope, { kind: 'track', id: track.id });
		assert.deepEqual(changes[0]?.data, { declaredChannels: declared, importedChannels: physical });
	} else assert.equal(changes.length, 0, 'an unchanged or unspecified channel width needs no conversion warning');
});

for (const order of [[1, 2], [2, 1]]) test(`DAWproject mixed-width track reports its final maximum, source order ${order.join(',')}`, async () => {
	const clips = order.map((width, index) => `<Clip time="${String(index / 10)}" duration=".1"><Audio channels="${String(width)}" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/${String(index)}.wav"/></Audio></Clip>`).join('');
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		projectXml: `<Project version="1.0"><Application name="Track widths" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular" audioChannels="2"/></Track><Track id="empty" name="Empty" contentType="audio"><Channel role="regular" audioChannels="1"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips>${clips}</Clips></Lanes></Lanes></Arrangement></Project>`,
		files: order.map((width, index) => ({ path: `audio/${String(index)}.wav`, blob: new Blob([Uint8Array.from(encodeWav(
			Array.from({ length: width }, () => new Float32Array(4800).fill(.125)), { sampleRate: 48_000, float: true }))]) })) });
	let nextId = 0;
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject, createStableId: prefix => `${prefix}-${String(++nextId)}` });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Mixed widths.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	assert.equal(opened.project.clips.length, 2);
	assert.deepEqual(opened.project.sources.map(source => source.kind === 'audio' ? source.channelCount : 0), order);
	const report = opened.report as DeliveryReport;
	assert.equal(report.counts.converted, 0, 'the native track already retains the declared final width and an empty strip has no audible width to convert');
	assert.ok(report.items.every(item => item.code !== 'dawproject.track-channel-width-converted'));
});
