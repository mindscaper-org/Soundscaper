/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFreesoundApiClient } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundPanelSession } from '../src/common/editor/ui/workspace/freesound-panel-session.ts';
import { encodeWav } from '../src/common/editor/wav.js';

for (const existingLocal of [false, true]) {
	test(`Freesound restores a visible bounded queue when remote pending uploads exceed ${existingLocal ? 'the remaining' : 'its'} capacity`, async () => {
		const pending = Promise.withResolvers<Response>();
		const pendingRequested = Promise.withResolvers<void>();
		let id = 0;
		const client = createFreesoundApiClient({
			openAuthorization: () => undefined,
			request: async (path) => {
				if (path.endsWith('/oauth/session')) return Response.json({ data: {
					connected: true, user: { username: 'field-recorder' },
				} });
				if (path.endsWith('/uploads/pending')) {
					pendingRequested.resolve();
					return pending.promise;
				}
				if (path.endsWith('/uploads')) return Response.json({ data: { uploadFilename: 'local.wav' } });
				throw new Error(`Unexpected request: ${path}`);
			},
		});
		const session = createFreesoundPanelSession(client, { createId: () => `upload-${String(++id)}` });
		const initialized = session.initialize();
		await pendingRequested.promise;
		assert.equal(session.getSnapshot().auth.status, 'connected');
		if (existingLocal) session.enqueueFiles([audioFile('local.wav')]);
		pending.resolve(Response.json({ data: {
			pendingDescription: Array.from({ length: 101 }, (_, index) => `remote-${index}.wav`),
			pendingProcessing: [], pendingModeration: [],
		} }));
		await initialized;
		const restored = session.getSnapshot().uploadQueue.items;
		assert.equal(restored.length, 100, 'every admitted pending row must be visible after initialization');
		assert.equal(new Set(restored.map(item => item.id)).size, 100);
		if (existingLocal) assert.equal(restored[0]?.fileName, 'local.wav');
		assert.throws(() => session.enqueueFiles([audioFile('later.wav')]), /100/u);
		const removable = restored.find(item => item.sourceKind === 'remote');
		assert.ok(removable);
		session.remove(removable.id);
		assert.doesNotThrow(() => session.enqueueFiles([audioFile('later.wav')]));
		assert.equal(session.getSnapshot().uploadQueue.items.length, 100);
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(session.getSnapshot().uploadQueue.items.find(item => item.fileName === 'later.wav')?.status, 'ready-to-publish');
	});
}

function audioFile(name: string): File {
	const bytes = encodeWav([Float32Array.of(0, 0.25, -0.25)], { sampleRate: 8_000, bitDepth: 16 });
	return new File([Uint8Array.from(bytes).buffer], name, { type: 'audio/wav' });
}
