/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Service } from '../../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { DesktopPhotoLibrarySessionOwnerCurrentV1 as LocalOwner } from '../../src/lightscaper/desktop-photo-library-session-owner-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from '../../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1 } from './lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';
export { channels };
export const OPEN_ID = 'a'.repeat(64);

export async function nativeSessionProtocolFixtureCurrentV1(context: TestContext,
	run: (value: Awaited<ReturnType<typeof create>>) => Promise<void>): Promise<void> {
	await nativeSessionRuntimeFixtureCurrentV1(context, async actual => {
		const value = await create(actual);
		const stop = (): void => { value.service.stop(value.owner); void value.service.closeAll().catch(() => undefined); };
		context.signal.addEventListener('abort', stop, { once: true }); if (context.signal.aborted) stop();
		let failed = false, primary: unknown;
		try { await run(value); } catch (error) { failed = true; primary = error; }
		let cleanupFailed = false, cleanup: unknown;
		try { await value.service.closeAll(); } catch (error) { cleanupFailed = true; cleanup = error; }
		context.signal.removeEventListener('abort', stop);
		if (cleanupFailed) throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Native Main protocol fixture retirement failed.');
		if (failed) throw primary;
	});
}

async function create(actual: Parameters<Parameters<typeof nativeSessionRuntimeFixtureCurrentV1>[1]>[0]) {
	const manager = actual.scopes, owner = Object.freeze({}), local = new LocalOwner();
	const descriptor = Object.getOwnPropertyDescriptor(Scopes.prototype, 'openSessionLease'); assert.ok(descriptor);
	const original = Scopes.prototype.openSessionLease; let captured: Awaited<ReturnType<Scopes['openSessionLease']>> | undefined;
	let service: Service;
	try {
		Object.defineProperty(Scopes.prototype, 'openSessionLease', { ...descriptor, value: function(this: Scopes, ...args: Parameters<Scopes['openSessionLease']>) {
			return (Reflect.apply(original, this, args) as ReturnType<Scopes['openSessionLease']>).then(lease => { if (this === manager) captured = lease; return lease; });
		} });
		// Main captures this pass-through method once. Restoring the prototype
		// immediately leaves all unrelated owners and later fixtures untouched.
		service = new Service(manager);
	} finally { Object.defineProperty(Scopes.prototype, 'openSessionLease', descriptor); }
	const opened = await service.open(owner, { name: 'Actual Main wire Session', openId: OPEN_ID }, local);
	assert.ok(captured); const components = captured.components;
	let requestId = 0;
	const envelope = (payload: unknown, exclusiveId: string | null = null) => ({ identity: { schemaVersion: 1, sessionId: opened.sessionId, requestId: ++requestId, exclusiveId }, payload });
	return { directory: actual.directory, selected: actual.selected, photos: actual.photos, raw: actual.raw, hdr: actual.hdr, resource: actual.resource,
		scopes: manager, components, storage: actual.storage, gate: actual.gate, reached: actual.reached, track: actual.track,
		service, owner, local, descriptor: opened, envelope,
		call: (channel: string, payload: unknown, exclusiveId: string | null = null): Promise<unknown> => service.dispatch(channel, owner, envelope(payload, exclusiveId)),
	};
}
