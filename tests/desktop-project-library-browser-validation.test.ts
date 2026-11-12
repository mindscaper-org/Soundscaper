/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	parseSoundscaperDesktopLibraryMetadataJson,
	validateSoundscaperDesktopLibraryMetadata,
} from '../desktop/soundscaper-project-library-metadata.ts';
import {
	createLegacySoundscaperDesktopLibraryFreezeMediaBinding,
	createSoundscaperDesktopLibraryFreezeMediaBinding,
} from '../desktop/soundscaper-project-library-media-binding.ts';

const SHA256 = 'a'.repeat(64);
const PROJECT = {
	id: 'project-one', projectId: '🌊'.repeat(1024), name: 'é'.repeat(512),
	metadataFile: `project-one/1-${SHA256}.json`, preferredProduct: 'soundscaper',
	updatedAtMs: 0, schemaFamily: 'soundscaper', schemaVersion: 1,
	projectRevision: 1, byteLength: 2, sha256: SHA256,
};

test('project metadata validates without a global Buffer and retains UTF-8 field limits', () => {
	withoutNodeBuffer(() => {
		const metadata = { schemaVersion: 1, revision: 1, projects: [PROJECT], media: [] };
		assert.deepEqual(validateSoundscaperDesktopLibraryMetadata(metadata), metadata);
		assert.deepEqual(parseSoundscaperDesktopLibraryMetadataJson(JSON.stringify(metadata)), metadata);
		for (const project of [
			{ ...PROJECT, projectId: `${PROJECT.projectId}x` },
			{ ...PROJECT, name: `${PROJECT.name}x` },
		]) {
			assert.throws(() => validateSoundscaperDesktopLibraryMetadata({
				...metadata, projects: [project],
			}), /project (?:identity|name) is invalid/u);
		}
	});
});

test('metadata JSON retains its byte limit without a global Buffer', () => {
	withoutNodeBuffer(() => {
		const metadata = { schemaVersion: 1, revision: 0, projects: [], media: [] };
		const json = JSON.stringify(metadata);
		const bounded = json + ' '.repeat(4 * 1024 * 1024 - json.length);
		assert.deepEqual(parseSoundscaperDesktopLibraryMetadataJson(bounded), metadata);
		assert.throws(() => parseSoundscaperDesktopLibraryMetadataJson(`${bounded} `), /byte limit/u);
	});
});

test('freeze bindings retain their digest and UTF-8 identity limits without a global Buffer', () => {
	const identity = '🌊'.repeat(1024);
	const expected = createHash('sha256').update(JSON.stringify([
		'audio-f32le-chunks-v1', identity, 'storage-key', 4, SHA256,
	])).digest('hex');
	const legacy = createHash('sha256').update(JSON.stringify([
		'audio-f32le-chunks-v1', identity, 1, SHA256, 'storage-key',
	])).digest('hex');
	withoutNodeBuffer(() => {
		const binding = createSoundscaperDesktopLibraryFreezeMediaBinding(identity, 'storage-key', 4, SHA256);
		assert.deepEqual(binding, {
			id: `f${expected}`, relativeFile: `freeze/${expected.slice(0, 2)}/f${expected}.scaf`,
			category: 'audio-freeze',
		});
		assert.equal(createLegacySoundscaperDesktopLibraryFreezeMediaBinding(
			identity, 'storage-key', 1, SHA256,
		).id, `f${legacy}`);
		for (const [sourceId, storageKey] of [[`${identity}x`, 'storage-key'], ['source', `${identity}x`]]) {
			assert.throws(() => createSoundscaperDesktopLibraryFreezeMediaBinding(
				sourceId!, storageKey!, 4, SHA256,
			), /byte limit/u);
			assert.throws(() => createLegacySoundscaperDesktopLibraryFreezeMediaBinding(
				sourceId!, storageKey!, 1, SHA256,
			), /byte limit/u);
		}
	});
});

function withoutNodeBuffer(run: () => void): void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
	try {
		Reflect.deleteProperty(globalThis, 'Buffer');
		run();
	} finally {
		Object.defineProperty(globalThis, 'Buffer', descriptor);
	}
}
