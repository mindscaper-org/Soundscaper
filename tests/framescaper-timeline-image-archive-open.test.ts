/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { framescaperPortableTimelineImage, openFramescaperImageFixtureLibrary, saveFramescaperImageFixtureArchive } from './helpers/framescaper-portable-timeline-image.ts';

test('File Open restores an archived Framescaper timeline image in a fresh library', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-archive-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const fixture = await framescaperPortableTimelineImage(directory);
	const { project, source, original, pixels } = fixture;
	const sender = await openFramescaperImageFixtureLibrary();
	try {
		const input = await saveFramescaperImageFixtureArchive(directory, sender, fixture);
		const recipient = await openFramescaperImageFixtureLibrary();
		const controller = createFramescaperAudioEditorController(recipient, { locale: 'en' });
		try {
			await controller.ready;
			assert.equal(await recipient.store.loadProject(project.id), null);
			const reopened = await controller.actions.project.openScapeFile(input, () => assert.fail('A fresh library should open without a collision decision.'));
			assert.equal(reopened?.project.id, project.id);
			assert.deepEqual(controller.project?.clips, project.clips);
			assert.deepEqual((await recipient.store.loadProject(project.id))?.clips, project.clips);
			const metadata = await recipient.store.getMediaAssetMetadata(source.storageKey);
			assert.equal(metadata?.sha256, source.contentSha256);
			assert.equal(metadata?.pendingProjectUntil, undefined);
			const body = await recipient.store.loadMediaAsset(source.storageKey);
			assert.ok(body);
			const reader = await openFramescaperImageFramePackV1({ source,
				read: async (offset, length) => new Uint8Array(await body.slice(offset, offset + length).arrayBuffer()),
			});
			assert.deepEqual(await reader.readOriginal(), original);
			assert.deepEqual(await reader.readFrame(0), pixels);
		} finally { await controller.dispose(); await recipient.close(); }
	} finally { await sender.close(); }
});

test('Scape image publication rejects an absent or mismatched staged body', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-archive-guard-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const { project, source, bytes } = await framescaperPortableTimelineImage(directory);
	const recipient = await openFramescaperImageFixtureLibrary();
	try {
		const create = () => recipient.store.createScapeProjectIfAbsent(project);
		await assert.rejects(create, /staged image body/iu);
		const wrong = bytes.slice();
		wrong[0] ^= 1;
		const writer = await recipient.store.beginMediaAssetWrite(source.storageKey, {
			name: source.name, kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', mimeType: source.mimeType,
		}, { expectedBytes: wrong.byteLength, expectedSha256: createHash('sha256').update(wrong).digest('hex') });
		await writer.write(wrong);
		const staged = await writer.commitOwned();
		try {
			await assert.rejects(create, /staged .*image body/iu);
			assert.equal(await recipient.store.loadProject(project.id), null);
			assert.deepEqual(await recipient.store.listProjectRevisions(project.id), []);
			assert.ok((await recipient.store.getMediaAssetMetadata(source.storageKey))?.pendingProjectUntil);
		} finally { await staged.discardIfCurrent(); }
	} finally { await recipient.close(); }
});
