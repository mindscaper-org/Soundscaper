/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import manifest from '../config/ffmpeg-runtime-manifest.json' with { type: 'json' };
import cors from '../r2-cors.json' with { type: 'json' };

const ORIGINS = ['http://127.0.0.1:4321', 'http://localhost:4321', 'https://framescaper.org',
	'https://lightscaper.org', 'https://mindscaper.org', 'https://soundscaper.org'];

test('shared runtime CORS admits Lightscaper and preserves every existing exact browser rule', () => {
	assert.deepEqual(cors, { rules: [{ allowed: { origins: ORIGINS, methods: ['GET', 'HEAD'], headers: ['Range'] },
		exposeHeaders: ['Content-Length', 'Content-Range', 'ETag'], maxAgeSeconds: 86_400 }] });
	assert.deepEqual(manifest.publication.corsOrigins, ORIGINS);
});

test('shared runtime CORS remains authenticated by its actual source bytes', async () => {
	const bytes = await readFile(new URL('../r2-cors.json', import.meta.url));
	assert.deepEqual(manifest.publication.cors, { path: 'r2-cors.json', byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex') });
});
