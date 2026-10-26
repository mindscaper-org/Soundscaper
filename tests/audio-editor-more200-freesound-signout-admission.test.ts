/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFreesoundApiClient } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundPanelSession } from '../src/common/editor/ui/workspace/freesound-panel-session.ts';

for (const status of [204, 503]) test(`Freesound sign-out retires upload admission while its ${status} response is pending`, async () => {
	let release!: (response: Response) => void;
	const response = new Promise<Response>(resolve => { release = resolve; });
	const client = createFreesoundApiClient({ openAuthorization() {}, request: async (path, init) => {
		if (init?.method === 'DELETE') return response;
		if (path.endsWith('/oauth/session')) return Response.json({ data: { connected: true, user: { username: 'recorder' } } });
		if (path.endsWith('/oauth/start')) return Response.json({ data: {
			attemptId: 'retry', handoffToken: 'retry-handoff', expiresAt: new Date(Date.now() + 60_000).toISOString(),
			authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback&response_type=code&state=retry',
		} });
		if (path.endsWith('/oauth/poll')) return Response.json({ data: { connected: true, user: { username: 'reconnected' } } });
		assert.ok(path.endsWith('/uploads/pending'));
		return Response.json({ data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } });
	} });
	const session = createFreesoundPanelSession(client);
	await session.initialize();
	assert.equal(session.getSnapshot().auth.status, 'connected');
	const signout = session.disconnect();
	try { assert.equal(session.getSnapshot().auth.status, 'loading', 'the upload surface must retire before awaiting sign-out IO'); }
	finally {
		release(status === 204 ? new Response(null, { status }) : Response.json({ error: { code: 'unavailable', message: 'Sign-out failed.' } }, { status }));
		await signout;
	}
	assert.equal(session.getSnapshot().auth.status, status === 204 ? 'disconnected' : 'error');
	assert.deepEqual(session.getSnapshot().uploadQueue.items, []);
	await session.connect();
	assert.equal(session.getSnapshot().auth.status, 'connected');
	assert.equal(session.getSnapshot().auth.user?.username, 'reconnected');
});
