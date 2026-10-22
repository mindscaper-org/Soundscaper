/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSessionProtocolFixtureCurrentV1 as fixture, channels } from './helpers/lightscaper-native-session-protocol-integration-fixture-current.ts';

for (const group of [false, true]) void test(`Main cancelled ${group ? 'group' : 'single'} Original acquisition joins the actual issued pin with an ID-only close`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const requests = f.photos.slice(0, group ? 2 : 1).map(photo => ({ catalogId: f.selected.catalogId, photoId: photo.id, original: photo.original }));
		const packet = f.envelope(group ? { requests } : { request: requests[0] });
		const opening = f.service.dispatch(group ? channels.originalOpenGroup : channels.originalOpen, f.owner, packet);
		let rejected = false, reason: unknown;
		const joined = opening.then(() => undefined, (error: unknown) => { rejected = true; reason = error; });
		await f.call(channels.cancel, { requestId: packet.identity.requestId }); await joined;
		assert.equal(rejected, true); assert.ok(reason instanceof DOMException); assert.equal(reason.name, 'AbortError');
		// Root retirement itself is logical. Delete the actual shared asset
		// afterward to prove no physical consumer pin survived cancellation.
		await f.call(channels.custody, { operation: 'release', photoIds: f.photos.slice(0, 2).map(photo => photo.id) });
		await f.call(channels.upload, { operation: 'delete-asset', assetId: 'runtime-shared' });
	});
});
