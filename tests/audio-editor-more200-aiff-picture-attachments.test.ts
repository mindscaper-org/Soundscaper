/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';

const pictures = [
	{ mimeType: 'image/png', pictureType: 3, description: 'Front photograph',
		data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=' },
	{ mimeType: 'image/png', pictureType: 4, description: 'Back photograph',
		data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQkTsBAAFEAPtKtXAbAAAAAElFTkSuQmCC' },
];

for (const format of ['aiff', 'wav'] as const) test(`${format} File Import preserves each authored picture as a hashed attachment`, async () => {
	const channels = [new Float32Array(4800).fill(.25)];
	const metadata = { title: 'Artwork programme', id3Artwork: JSON.stringify(pictures) };
	const bytes = format === 'aiff' ? encodeAiff(channels, { sampleRate: 48_000, sampleFormat: 'float32', metadata })
		: encodeWav(channels, { sampleRate: 48_000, bitDepth: 32, float: true, metadata });
	assert.ok(bytes instanceof Uint8Array);
	const result = await inspectImportedMediaMetadata(new File([Uint8Array.from(bytes)], `Pictures.${format}`, { type: `audio/${format}` }));
	assert.deepEqual(result.warnings, []);
	assert.equal(result.metadata.normalized?.title, 'Artwork programme');
	assert.deepEqual(result.attachments.filter(attachment => attachment.mimeType === 'image/png'), pictures.map((picture, index) => ({
		path: `images[${String(index)}]`, kind: index ? 'coverBack' : 'coverFront', mimeType: picture.mimeType,
		description: picture.description, byteLength: Buffer.from(picture.data, 'base64').byteLength,
		sha256: createHash('sha256').update(Buffer.from(picture.data, 'base64')).digest('hex'),
	})));
});
