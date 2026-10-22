/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { createDesktopPhotoLibrarySessionServiceCurrentV1 } from '../../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import { createDesktopPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service, DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from '../../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as CHANNELS } from '../../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1, Session } from './lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';
export { remainsPending, runtimeShaCurrentV1 } from './lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';

/** Actual Main dispatcher -> actual selected SQLite/FS owners -> complete local
	* client -> actual Current constructor. No positive storage/decoder is replaced. */
export async function nativeSessionClientFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>): Promise<void> {
	await nativeSessionRuntimeFixtureCurrentV1(context, async native => {
	 const fixture = createFixture(native); let failed = false, primary: unknown;
	 const cancel = (): void => { native.release(); void fixture.close().catch(() => undefined); };
	 context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	 try { await run(fixture); } catch (error) { failed = true; primary = error; }
	 try { await fixture.close(); } catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Native protocol fixture did not retire.', { cause: cleanup }); }
	 finally { context.signal.removeEventListener('abort', cancel); }
	 if (failed) throw primary;
	});
}
function createFixture(native: Parameters<Parameters<typeof nativeSessionRuntimeFixtureCurrentV1>[1]>[0]) {
	const sessions = new Set<Session>(), pending = new Set<Promise<unknown>>(), controls = new Map<string, (kind: 'stop' | 'retire') => Promise<void>>();
	const owner = Object.freeze({ kind: 'actual-native-client-test-document' });
	let main = new Main(native.scopes), current: Readonly<Storage> | undefined, closed = false, closing: Promise<void> | undefined;
	const sent: { channel: string; payload: unknown }[] = [];
	const hooks = { reply: async (_channel: string, _payload: unknown, _result: unknown): Promise<void> => undefined };
	const install = () => createDesktopPhotoLibrarySessionServiceCurrentV1({
	 async invoke(channel, payload) {
	  sent.push({ channel, payload });
	  if (channel === CHANNELS.open) {
	   assert.ok(payload && typeof payload === 'object' && 'openId' in payload && typeof payload.openId === 'string');
	   const handler = controls.get(payload.openId); assert.ok(handler);
	   const result = await main.open(owner, payload, Object.freeze({ close: () => handler('retire') })); await hooks.reply(channel, payload, result); return result;
	  }
	  const result = await main.dispatch(channel, owner, payload); await hooks.reply(channel, payload, result); return result;
	 },
	 installRetirement(openId, handler) { assert.equal(controls.has(openId), false); controls.set(openId, handler); return () => { controls.delete(openId); }; },
	});
	let client = install();
	const service: Service = Object.freeze<Service>({ async open(options, localOwner) { current = await client.open(options, localOwner); return current; } });
	const track = <Value>(work: Promise<Value>): Promise<Value> => { pending.add(work); void work.then(() => pending.delete(work), () => pending.delete(work)); return work; };
	return { directory: native.directory, selected: native.selected, photos: native.photos, resource: native.resource, raw: native.raw, hdr: native.hdr,
		storage: native.storage, gate: native.gate, reached: native.reached, track, corruptLegacy: native.corruptLegacy, release: native.release, service, sent, controls, hooks,
		get scopes() { return native.scopes; },
	 get components() { assert.ok(current); return current.components; },
		exclusive: <Result>(catalogId: string, operation: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> => { assert.ok(current); return current.exclusive(catalogId, operation, signal); },
	 open(signal?: AbortSignal): Promise<Session> {
	  assert.equal(closed, false); return track(createDesktopPhotoLibrarySessionCurrentV1({ name: 'Native complete Session', service,
	   ...(signal ? { signal } : {}), originalSourceOptions: { storage: native.storage.storage } }).then(session => { sessions.add(session); return session; }));
	 },
	 async reopen(): Promise<void> {
	  await Promise.all([...sessions].map(session => session.close())); await main.closeAll(); await native.reopen(); main = new Main(native.scopes); client = install();
	 },
	 close(): Promise<void> {
	  if (closing) return closing; closed = true;
	  closing = Promise.resolve().then(async () => { native.release(); await Promise.allSettled([...pending]); const errors: unknown[] = [];
	   for (const session of sessions) { try { await session.close(); } catch (error) { errors.push(error); } }
	   try { await main.closeAll(); } catch (error) { errors.push(error); }
	   if (errors.length) throw new AggregateError(errors, 'Actual protocol Session/Main retirement failed.');
	  }); return closing;
	 },
	};
}
