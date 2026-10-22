/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createId3Artwork, parseId3Artwork } from '../src/common/editor/id3-artwork.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');

test('a valid PNG with a legal filesystem newline has an admissible default artwork description', async () => {
	const file = new File([PNG], 'cover\nimage.png', { type: 'image/png' });
	const picture = await createId3Artwork(file);
	assert.equal(picture.description, 'cover image.png');
	assert.deepEqual(Buffer.from(picture.data, 'base64'), PNG);
	const pictures = parseId3Artwork([picture]);
	const delivered = createAudioMetadataId3Tag({ id3Artwork: JSON.stringify(pictures) });
	assert.ok(Buffer.from(delivered).includes(PNG));
	assert.ok(Buffer.from(delivered).includes(Buffer.from('cover image.png')));
});
