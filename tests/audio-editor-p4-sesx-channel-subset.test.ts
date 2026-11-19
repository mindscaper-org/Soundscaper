/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSesxDocument } from '../src/common/editor/sesx-import.ts';
import { buildSesxProject } from '../src/common/editor/sesx-import-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { sesxDesktopHardwareFixture } from './helpers/sesx-desktop-hardware-fixture.ts';

for (const { label, channels, map, omitted } of [
	{ label: 'left identity subset of stereo', channels: 2, map: [0], omitted: true },
	{ label: 'right subset of stereo', channels: 2, map: [1], omitted: true },
	{ label: 'complete stereo identity', channels: 2, map: [0, 1], omitted: false },
	{ label: 'complete mono identity', channels: 1, map: [0], omitted: false },
	{ label: 'swapped stereo', channels: 2, map: [1, 0], omitted: true },
	{ label: 'duplicated mono', channels: 1, map: [0, 0], omitted: true },
	{ label: 'implicit stereo', channels: 2, map: null, omitted: false },
]) test(`SESX ${label} map preserves existing unsupported-conversion accounting`, async context => {
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
	const sourceXml = `<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks><audioTrack><trackParameters><name>Selected source channels</name></trackParameters>
	<trackAudioParameters audioChannelType="${map?.length === 1 ? 'mono' : 'stereo'}"/><audioClip fileID="0" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800">
	${map ? `<channelMap>${map.map((sourceIndex, index) => `<channel index="${index}" sourceIndex="${sourceIndex}"/>`).join('')}</channelMap>` : ''}
	</audioClip></audioTrack></tracks></session><files><file id="0" relativePath="Stereo.wav"/></files></sesx>`;
	const pcm = Array.from({ length: channels }, (_, index) => new Float32Array(4800).fill(index ? .375 : .125));
	const wave = Uint8Array.from(encodeWav(pcm, { sampleRate: 48_000, float: true }));
	const hardware = await sesxDesktopHardwareFixture(sourceXml, wave); context.after(hardware.close);
	const native = createSoundscaperScapeNativeRuntime();
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const engine = { ...createMemoryEngine(), decodeAudioData: async () => assert.fail('SESX PCM must use the actual WAV reader') };
	const { controller, store } = await controllerSession(context, { fileService: hardware.fileService, scapeProjectRuntime: native,
		engine: engine as unknown as Options['engine'], engineFactory: () => assert.fail('SESX source custody cannot substitute a renderer') });
	const choices = await hardware.fileService.chooseFiles({ purpose: 'project', multiple: false });
	assert.equal(choices.length, 1); assert.equal(choices[0].readProfile, 'selected-range-v1');
	await hardware.fileService.withReadDescriptors(choices, {}, async (files: readonly File[]) => {
		assert.equal(files.length, 1); assert.equal(files[0]?.name, 'Selection.sesx');
		const result = await controller.actions.project.openSesx(files[0]); assert.ok(result);
		assert.deepEqual(controller.getSnapshot().deliveryReport, result.report);
		assert.ok(result.report && typeof result.report === 'object');
		const items: unknown = Reflect.get(result.report, 'items'); assert.ok(Array.isArray(items));
		const actualWarnings = items.filter((item: unknown) => item && typeof item === 'object' && Reflect.get(item, 'code') === 'sesx.channel-map-omitted');
		assert.equal(actualWarnings.length, omitted ? 1 : 0);
		for (const item of actualWarnings) {
			assert.equal(Reflect.get(item, 'disposition'), 'omitted'); assert.equal(Reflect.get(item, 'severity'), 'warning');
			const scope: unknown = Reflect.get(item, 'scope'); assert.ok(scope && typeof scope === 'object'); assert.equal(Reflect.get(scope, 'kind'), 'clip');
		}
	});
	const admitted = clipboardProject(controller.project), source = admitted.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(admitted.sources.length, 1); assert.equal(admitted.clips.length, 1);
	assert.equal(admitted.sampleRate, 48_000); assert.equal(admitted.masterChannels, 2);
	assert.deepEqual([source.name, source.sampleRate, source.channelCount, source.frameCount], ['Stereo.wav', 48_000, channels, 4800]);
	assert.deepEqual([admitted.clips[0]?.timelineStartFrame, admitted.clips[0]?.sourceStartFrame, admitted.clips[0]?.sourceDurationFrames], [0, 0, 4800]);
	assertPcmChannelsEqual(await readCustodyPcm(store, source), pcm, 'every physical SESX source sample');
	const contribution = normalizeSourceProvenance(source.provenance).contributions[0]; assert.ok(contribution);
	assert.deepEqual(contribution.origin, { kind: 'local-file', originalFileName: 'Stereo.wav', byteLength: wave.byteLength,
		mimeType: 'audio/wav', lastModified: null });
	assert.equal(hardware.releasedSessions.length, 1); assert.equal(hardware.releasedReads.length, 2);
	assert.ok(hardware.requests.some(request => request.url.endsWith('/Selection.sesx')));
	assert.ok(hardware.requests.some(request => request.url.endsWith('/Stereo.wav')));
	assert.ok(hardware.requests.every(request => request.status === 206 && /^bytes=\d+-\d+$/u.test(request.range ?? '')));
	await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(admitted.id), admitted);
	const archive = await native.exportScapeProject(admitted, store); assert.ok(archive.blob);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const opened = await native.importScapeProject(archive.blob, recipient); assert.equal(opened.readOnly, false);
	assert.deepEqual(opened.project, admitted); assert.deepEqual(await recipient.loadProject(admitted.id), admitted);
	const restored = clipboardProject(opened.project).sources[0]; assert.ok(restored?.kind === 'audio');
	assertPcmChannelsEqual(await readCustodyPcm(recipient, restored), pcm, 'every SESX source sample after fresh Scape');
});
