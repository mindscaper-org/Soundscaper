/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';
import { importedDawprojectArchiveCustody } from './helpers/imported-dawproject-archive-custody.ts';

const CREDITS = { originalArtist: 'Original performer', composer: 'Composer & co.', songwriter: 'Song writer',
	producer: 'Producer', arranger: 'Arranger', genre: 'Genre', copyright: '© Reviewed owner', website: 'https://example.test/credits' };
const FIELDS = ['OriginalArtist', 'Composer', 'Songwriter', 'Producer', 'Arranger', 'Genre', 'Copyright', 'Website'];

for (const additional of [true, false]) test(`foreign DAW primary/additional credits=${additional} survive real stores, DAW delivery and Scape`, async () => {
	const metadataXml = '<MetaData><Title>Credits</Title><Artist>Performer</Artist><Album>Album</Album><Year>2026</Year><Comment>Session notes</Comment>'
		+ (additional ? FIELDS.map((field, index) => `<${field}><![CDATA[${Object.values(CREDITS)[index]}]]></${field}>`).join('') : '') + '</MetaData>';
	const result = await importedDawprojectArchiveCustody(await foreignRecording({ metadataXml }));
	for (const project of [result.initial, result.project]) {
		assert.deepEqual([project.metadata.title, project.metadata.artist, project.metadata.album, project.metadata.year, project.metadata.comments],
			['Credits', 'Performer', 'Album', '2026', 'Session notes']);
		assert.deepEqual(project.metadata.tags, additional ? CREDITS : {});
	}
	assert.deepEqual(Object.keys(CREDITS).map(key => result.document.metadata[key as keyof typeof CREDITS]),
		additional ? Object.values(CREDITS) : FIELDS.map(() => undefined));
	assertPcm(result.pcm, 2);
});

for (const [encoded, expected] of [['Room microphone', 'Room microphone'], ['  Room &amp; choir 🎙️  ', '  Room & choir 🎙️  '],
	['', 'encoded.wav'], ['   ', 'encoded.wav'], ['Room&#10;microphone', 'Room\nmicrophone'], ['Speech.mp3', 'Speech.mp3']] as const) {
	test(`foreign DAW media label ${JSON.stringify(encoded)} retains identity and source PCM through archives`, async () => {
		const result = await importedDawprojectArchiveCustody(await foreignRecording({ label: encoded }));
		for (const project of [result.initial, result.project]) {
			const source = project.sources[0], clip = project.clips[0]; assert.ok(source?.kind === 'audio' && clip?.kind === 'audio');
			assert.equal(source.name, expected); assert.equal(clip.title, expected);
			assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount, clip.durationFrames], [48_000, 4800, 2, 4800]);
			assert.equal(source.mimeType, 'audio/wav', 'display suffix cannot change encoded media identity');
		}
		const media = [...walkXml(result.document.root)].find(element => element.name === 'Audio'); assert.ok(media);
		assert.equal(media.attributes.name, expected);
		if (encoded === 'Room microphone' || encoded === '') {
			assert.equal(media.children.find(element => element.name === 'File')?.attributes.path,
				encoded ? 'audio/001-Room-microphone.wav' : 'audio/001-encoded.wav');
		}
		assertPcm(result.pcm, 2);
	});
}

for (const [declared, physical] of [[1, 2], [2, 2], [4, 2], [null, 2], [1, 1], [null, 1]] as const) test(`foreign DAW width ${String(declared)}/${physical} retains PCM and truthful conversion report through archives`, async () => {
	const result = await importedDawprojectArchiveCustody(await foreignRecording({ declared, physical }));
	for (const project of [result.initial, result.project]) {
		const source = project.sources[0]; assert.ok(source?.kind === 'audio');
		assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 4800, physical]);
	}
	const changes = result.importReport.items.filter(item => item.code === 'dawproject.track-channel-width-converted');
	const changed = declared !== null && declared !== physical;
	assert.equal(changes.length, changed ? 1 : 0);
	if (changed) {
		assert.equal(changes[0]?.severity, 'warning'); assert.equal(changes[0]?.disposition, 'converted');
		assert.deepEqual(changes[0]?.data, { declaredChannels: declared, importedChannels: physical });
	}
	assertPcm(result.pcm, physical);
});

function foreignRecording(options: { metadataXml?: string; label?: string; declared?: number | null; physical?: number } = {}) {
	const physical = options.physical ?? 2, declared = options.declared === undefined ? 2 : options.declared;
	const projectXml = `<Project version="1.0"><Application name="Custody" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular" ${declared === null ? '' : `audioChannels="${declared}"`}/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1"><Audio ${options.label === undefined ? '' : `name="${options.label}"`} channels="${physical}" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/encoded.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`;
	const channels = [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)].slice(0, physical);
	return writeDawprojectArchive({ projectXml, metadataXml: options.metadataXml ?? '<MetaData/>',
		files: [{ path: 'audio/encoded.wav', blob: new Blob([Uint8Array.from(encodeWav(channels, { sampleRate: 48_000, float: true }))]) }] });
}

function assertPcm(pcm: ReadonlyMap<string, number[][]>, channels: number): void {
	assert.equal(pcm.size, 1);
	assertPcmChannelsEqual([...pcm.values()][0], [new Array<number>(4800).fill(.25), new Array<number>(4800).fill(-.125)].slice(0, channels));
}
