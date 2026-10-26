/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readProfileForSelectedPath } from '../desktop/read-selection-service.js';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFile, NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
import { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob } from '../src/common/editor/desktop-selected-range-blob.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

// XML 1.0 §4.3.3 requires UTF-16 documents to carry a BOM. Both byte orders
// describe the same supported SESX document and use the ordinary desktop opener.
for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
	test(`desktop SESX File Open preserves ${encoding} names and stages the referenced WAV`, async () => {
		const xml = `<?xml version="1.0" encoding="${encoding === 'utf-8' ? 'UTF-8' : 'UTF-16'}"?>
			<!DOCTYPE sesx><sesx><session sampleRate="48000" audioChannelType="mono"><tracks><audioTrack>
			<trackParameters><name>Dialogue Café 🌊</name></trackParameters>
			<audioClip fileID="0" name="歌声 🎙" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800"/>
			</audioTrack></tracks></session><files><file id="0" relativePath="Café.wav"/></files></sesx>`;
		const result = await open(encode(xml, encoding));
		assert.equal(result.frames, 4800);
		assert.deepEqual(result.requestedPaths, ['Café.wav']);
		assert.deepEqual(result.samples, new Float32Array(4800).fill(.25));
		assert.ok(validateSoundscaperProject(result.project));
		const runtime = resolveRuntimeProjectProjection(result.project);
		assert.equal(runtime.tracks[0]?.name, 'Dialogue Café 🌊');
		assert.equal(runtime.clips[0]?.title, '歌声 🎙');
		assert.deepEqual(runtime.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames]), [[0, 4800]]);
	});
}

test('truncated UTF-16 SESX refuses before resolving or staging media', async () => {
	const bytes = encode('<sesx/>', 'utf-16le');
	await assert.rejects(open(bytes.subarray(0, bytes.length - 1)), error => {
		assert.ok(error instanceof Error);
		assert.match(error.message, /encoded data|invalid character|text data outside|unclosed|invalid.*encoding/iu);
		return true;
	});
});

function encode(xml: string, encoding: 'utf-8' | 'utf-16le' | 'utf-16be'): Uint8Array<ArrayBuffer> {
	if (encoding === 'utf-8') return new TextEncoder().encode(xml);
	const bytes = new Uint8Array(2 + xml.length * 2), view = new DataView(bytes.buffer);
	view.setUint16(0, 0xfeff, encoding === 'utf-16le');
	for (let index = 0; index < xml.length; index++) view.setUint16(2 + index * 2, xml.charCodeAt(index), encoding === 'utf-16le');
	return bytes;
}

async function open(bytes: Uint8Array<ArrayBuffer>) {
	const audio = new Blob([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, float: true }))]);
	let nextId = 0, frames = 0, released = 0;
	const requestedPaths: string[] = [], chunks: Float32Array[] = [];
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject,
		createStableId: prefix => `${prefix}-${++nextId}`,
		store: { estimateStorage: async () => ({ usage: 0, quota: 1e9 }),
			beginSourceWrite: async () => ({ write: async channels => {
				const channel = channels[0]; assert.ok(channel); frames += channel.length; chunks.push(channel.slice());
			}, commit: async () => undefined, abort: async () => undefined }), deleteSource: async () => undefined },
	});
	const fileService = { ...fixture.runtime.fileService, isDesktop: true,
		resolveSesxMedia: async ({ relativePath }) => {
			requestedPaths.push(relativePath);
			return { status: 'found', descriptor: { id: 'read', name: 'Café.wav', size: audio.size, lastModified: 0,
				mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', url: 'soundscaper-app://media/voice' } };
		},
		chooseSesxMediaFolder: async () => ({ status: 'cancelled' }),
		withReadDescriptors: async (_descriptors, _options, consume) => await consume([audio]),
		releaseSesxSession: async () => { released++; return true; },
	} satisfies NativeProjectFileService;
	const name = 'Café.sesx', id = 'a'.repeat(64);
	const profile: string = readProfileForSelectedPath('project', name);
	assert.equal(profile, 'selected-range-v1');
	const file = createDesktopSelectedRangeBlob({ id, name, size: bytes.length, mimeType: 'application/xml',
		readProfile: profile, lastModified: 0,
		url: `soundscaper-app://bundle/_desktop/read/${profile}/${id}/${encodeURIComponent(name)}`,
	}, { fetch: async (_url, request) => {
		const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(request.headers).get('Range') ?? '');
		assert.ok(range); const start = Number(range[1]), end = Number(range[2]);
		return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
			'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
			'Content-Length': String(end - start + 1), 'Content-Type': 'application/xml',
		} });
	} });
	assertNamedFile(file);
	try {
		const opened = await createNativeProjectService({ ...fixture.runtime, fileService }).openSesx(file);
		assert.ok(opened); assert.deepEqual(fixture.switched, [opened.project.id]);
		assert.equal(released, 1);
		const samples = new Float32Array(frames); let offset = 0;
		for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
		return { project: opened.project, frames, samples, requestedPaths };
	} catch (error) {
		assert.equal(frames, 0); assert.deepEqual(requestedPaths, []);
		assert.deepEqual(fixture.switched, []); assert.equal(fixture.state.importing, false); assert.equal(released, 1);
		throw error;
	} finally { retireDesktopSelectedRangeBlob(file); }
}

function assertNamedFile(file: Blob): asserts file is NativeProjectFile {
	assert.ok('name' in file && typeof file.name === 'string');
}
