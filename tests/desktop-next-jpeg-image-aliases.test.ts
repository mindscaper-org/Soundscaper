/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { registerSelectedReadCapability } from '../desktop/read-selection-service.js';
import { acceptsFile, mimeTypeForPath, validateFileChoice } from '../desktop/validation.js';

for (const suffix of ['jfif', 'jpe', 'jpg', 'jpeg']) test(`desktop Add Images admits the JPEG ${suffix} filename through a scoped read`, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'next-jpeg-image-'));
	const store = new ReadCapabilityStore();
	context.after(async () => { await store.dispose(); await rm(directory, { recursive: true, force: true }); });
	const filePath = join(directory, `Photo.${suffix.toUpperCase()}`);
	await writeFile(filePath, Uint8Array.of(255, 216, 255, 224));
	assert.equal(acceptsFile('image', filePath), true);
	assert.equal(mimeTypeForPath(filePath), 'image/jpeg');
	assert.ok(validateFileChoice({ purpose: 'image', multiple: true }).filters.some((filter: { extensions: readonly string[] }) => filter.extensions.includes(suffix)));
	const owner = {};
	const descriptor = await registerSelectedReadCapability(store, filePath, { owner, purpose: 'image' });
	assert.equal(descriptor.readProfile, 'selected-range-v1');
	assert.equal(descriptor.mimeType, 'image/jpeg');
	assert.equal(await store.release(descriptor.id, { owner }), true);
	assert.equal(acceptsFile('audio', filePath), false);
	assert.equal(acceptsFile('image', `${filePath}.exe`), false);
});
