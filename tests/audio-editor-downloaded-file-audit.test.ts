/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadFreesoundImport } from '../src/common/editor/controller/import/internal/freesound-import-download.ts';

const sound = { id: 1, name: 'fallback.wav', preview: { available: true }, originalFile: { byteLength: 4, format: 'wav' } };
const options = { sound, variant: 'original' as const, maximumOriginalBytes: 100, maximumPreviewBytes: 100,
	url: new URL('https://example.test/original'),
};

test('extended download filenames accept their optional language field', async () => {
	const result = await downloadFreesoundImport({ ...options, fetch: async () => new Response('data', { headers: {
		'Content-Type': 'audio/wav', 'Content-Disposition': "attachment; filename*=UTF-8'en'Field%20recording.wav",
	} }) });
	assert.equal(result.fileName, 'Field recording.wav');
});

test('quoted download filenames handle escaped quotes without truncating their extension', async () => {
	const result = await downloadFreesoundImport({ ...options, fetch: async () => new Response('data', { headers: {
		'Content-Type': 'audio/wav', 'Content-Disposition': 'attachment; filename="take \\"one\\".wav"',
	} }) });
	assert.equal(result.fileName, 'take -one-.wav');
});

test('download filename truncation retains the audio extension and whole Unicode characters', async () => {
	for (const stem of ['a'.repeat(260), '録'.repeat(100)]) {
	const result = await downloadFreesoundImport({ ...options,
		sound: { ...sound, name: `${stem}.wav` },
		fetch: async () => new Response('data', { headers: { 'Content-Type': 'audio/wav' } }),
	});
	assert.match(result.fileName, /\.wav$/u);
	assert.ok(new TextEncoder().encode(result.fileName).length <= 255);
	}
});

test('refused download MIME types cancel the unread file body', async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
	await assert.rejects(downloadFreesoundImport({ ...options,
		fetch: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
	}), /not audio/u);
	assert.equal(cancelled, true);
});
