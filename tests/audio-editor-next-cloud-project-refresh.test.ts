/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudiocomProjectArchives, type AudiocomProjectArchiveClient } from '../src/common/editor/controller/import/audiocom-project-archives.ts';
import { createAup3Fixture } from './aup3-fixture.js';

test('a committed cloud project save stays successful when refreshing its listing fails', async () => {
	const bytes = await createAup3Fixture({ projectName: 'Committed recording' });
	const file = new File([Uint8Array.from(bytes).buffer], 'Committed recording.aup3', { type: 'application/octet-stream' });
	const uploaded = { id: '12345678-1234-4234-8234-123456789abc', name: 'Committed recording',
		format: 'aup3' as const, size: file.size, snapshotId: 'aaaaaaaa-1234-4234-8234-123456789abc' };
	let listingUnavailable = true;
	const client: AudiocomProjectArchiveClient = {
		async capabilities() { return { formats: ['aup3'], maximumBytes: 100_000_000 }; },
		async upload() { return uploaded; },
		async list(page) {
			if (listingUnavailable) throw new Error('The project listing is temporarily unavailable.');
			return { results: [uploaded], page, hasNext: false };
		},
	};
	const archives = createAudiocomProjectArchives({ client, revisionStorage: null });
	try {
		await archives.setConnected(true);
		await archives.saveProject('local-recording', async () => file);
		assert.equal(archives.getSnapshot().status, 'ready');
		assert.equal(archives.getSnapshot().completedFileName, file.name);
		assert.match(archives.getSnapshot().errorMessage ?? '', /listing.*unavailable/u);
		listingUnavailable = false;
		await archives.refresh(1);
		assert.deepEqual(archives.getSnapshot().results, [uploaded]);
		assert.equal(archives.getSnapshot().errorMessage, undefined);
	} finally { archives.dispose(); }
});
