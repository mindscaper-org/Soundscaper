/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { installLightscaperMainPhotoSessionCurrentV1 as install } from '../desktop/lightscaper-main-photo-session-current-v1.ts';
import { createLightscaperPreloadSessionCurrentV1 as preload } from '../desktop/lightscaper-preload-session-current-v1.ts';
import { createDesktopPhotoLibrarySessionServiceCurrentV1 as service } from '../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import { createDesktopPhotoLibrarySessionCurrentV1 as create } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as CHANNELS } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_RESTORE_CHANNELS_CURRENT_V1 as RESTORE } from '../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
import { readDesktopPhotoSessionResponseCurrentV1 as response } from '../src/lightscaper/desktop-photo-session-response-current-v1.ts';
import type { LightscaperPreloadIpcCurrentV1 as Ipc } from '../desktop/lightscaper-preload-bridge-current-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1 as fixture, remainsPending } from './helpers/lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';

const options = { timeout: 15_000 };
type Handler = (event: unknown, ...args: unknown[]) => unknown;
function bridge(appDataPath: string, context: TestContext, track: (work: Promise<void>) => Promise<void>) {
	const handlers = new Map<string, Handler>(), listeners = new Map<string, (event: unknown, value: unknown) => void>(), failures: unknown[] = [];
	const contents = { send(channel: string, value: unknown) { listeners.get(channel)?.({}, structuredClone(value)); }, isDestroyed: () => false,
		getOSProcessId: () => process.pid, forcefullyCrashRenderer: () => { throw new Error('These in-process tests cannot certify renderer process loss.'); } };
	const event = { sender: contents, processId: 71, frameId: 3 }; let descriptor: unknown;
	const host = install({ appDataPath, handle(channel, handler) { assert.equal(handlers.has(channel), false); handlers.set(channel, handler); }, reportError: error => { failures.push(error); } });
	const ipc: Ipc = {
		invoke(channel, ...args) {
			try {
				const handler = handlers.get(channel); assert.ok(handler);
				return Promise.resolve(handler(event, ...structuredClone(args))).then(value => {
					const result: unknown = structuredClone(value);
					if (channel === CHANNELS.open && result && typeof result === 'object' && 'value' in result) descriptor = result.value;
					return result;
				});
			} catch (error) { return Promise.reject(error); }
		},
		on(channel, listener) { listeners.set(channel, listener); }, removeListener(channel, listener) { assert.equal(listeners.get(channel), listener); listeners.delete(channel); },
	};
	host.activate(contents, event.processId, event.frameId);
 let closing: Promise<void> | undefined;
 const close = (): Promise<void> => {
  if (closing) return closing;
  const actual = host.close(); closing = actual.finally(() => { context.signal.removeEventListener('abort', cancel); });
  void track(closing); return closing;
 };
 const cancel = (): void => { void close().catch(() => undefined); };
 context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	return { host, close, transport: preload(ipc), handlers, contents, event, failures, descriptor: () => descriptor };
}

void test('Installed Main host and private preload compose actual complete native Current Session through copied wire records', options, async context => {
	await fixture(context, async f => {
		await f.scopes.close(); const b = bridge(f.directory, context, f.track), client = service(b.transport);
		const session = await create({ name: 'Native complete Session', service: client, originalSourceOptions: { storage: f.storage.storage } });
		try {
			assert.equal((await session.readPage()).totalCount, 3);
			assert.equal((await session.setRating(f.photos[0]!.id, 5)).rating, 5);
			assert.equal((await session.readPreview(f.photos[2]!.id, 'thumbnail')).outcome, 'ready');
			await session.close(); await b.close(); assert.deepEqual(b.failures, []); assert.equal(f.storage.counts().stages, 0);
		} finally { await session.close(); await b.close(); }
	});
});

void test('Actual document ownership refuses foreign sender/process/frame before any borrowed request reflection', options, async context => {
	await fixture(context, async f => {
		await f.scopes.close(); const b = bridge(f.directory, context, f.track); let reflections = 0;
		const poison = new Proxy({}, { ownKeys() { reflections++; throw new Error('borrowed envelope'); }, get() { reflections++; throw new Error('borrowed envelope'); } });
		try {
			const handler = b.handlers.get(CHANNELS.catalog); assert.ok(handler);
			for (const event of [{ ...b.event, sender: {} }, { ...b.event, processId: 72 }, { ...b.event, frameId: 4 }]) {
				await assert.rejects(Promise.resolve().then(() => handler(event, poison)));
			}
			assert.equal(reflections, 0); assert.deepEqual(b.failures, []);
		} finally { await b.close(); }
	});
});

void test('Main host consumes actual native send admission synchronously and joins held real renderer File consumer on close', options, async context => {
	await fixture(context, async f => {
		await f.scopes.close(); const b = bridge(f.directory, context, f.track), session = await create({ name: 'Native complete Session', service: service(b.transport), originalSourceOptions: { storage: f.storage.storage } });
		const original = Main.prototype.dispatch; let admitted = 0, closing: Promise<void> | undefined;
		Main.prototype.dispatch = function (...args) { admitted++; return Reflect.apply(original, this, args) as ReturnType<typeof original>; };
		const entered = f.gate(), release = f.gate(), handoff = session.collectionHandoffCurrent; assert.ok(handoff);
		let work: Promise<unknown> | undefined;
		try {
			const descriptor = b.descriptor(); assert.ok(descriptor && typeof descriptor === 'object' && 'sessionId' in descriptor);
			const handler = b.handlers.get(CHANNELS.catalog); assert.ok(handler);
			const before = admitted, response = handler(b.event, { identity: { schemaVersion: 1, sessionId: descriptor.sessionId, requestId: 1000, exclusiveId: null }, payload: { operation: 'load' } });
			assert.equal(admitted, before + 1); await response;
			// This probe consumes a high watermark; open a fresh actual connection
			// before its owning client resumes normal monotonic request IDs.
			await session.close();
			const next = await create({ name: 'Native complete Session', service: service(b.transport), originalSourceOptions: { storage: f.storage.storage } });
			try {
				const collection = next.collectionHandoffCurrent; assert.ok(collection);
				work = collection.withCapture({ catalogId: f.selected.catalogId, collectionId: 'manual', scope: 'catalog', expectedCatalogRevision: 2 },
					view => view.withOriginal(f.photos[0]!.id, async file => { const bytes = new Uint8Array(await file.arrayBuffer()); bytes.fill(0); entered.release(); await release.promise; }));
				void work.catch(() => undefined); await f.reached(entered.promise, work);
				closing = b.close(); assert.equal(await remainsPending(closing), true); assert.ok(f.storage.counts().stages > 0);
				release.release(); await assert.rejects(work); await closing; assert.equal(f.storage.counts().stages, 0);
			} finally { release.release(); await work?.catch(() => undefined); await next.close(); }
		} finally { release.release(); await session.close(); await closing; await b.close(); Main.prototype.dispatch = original; }
	});
});

void test('Native restore opening refuses a still-live selected Session before borrowed payload fields', options, async context => {
 await fixture(context, async f => {
  await f.scopes.close(); const b = bridge(f.directory, context, f.track);
  let session: Awaited<ReturnType<typeof create>> | undefined;
  try {
   session = await create({ name: 'Native complete Session', service: service(b.transport), originalSourceOptions: { storage: f.storage.storage } });
   let reflected = 0;
   const poison = new Proxy({}, { ownKeys() { reflected++; throw new Error('Live selected Session must fence restore capture.'); } });
   const handler = b.handlers.get(RESTORE.begin); assert.ok(handler);
   const result = await handler(b.event, poison); assert.throws(() => response(result)); assert.equal(reflected, 0);
  } finally { await session?.close(); await b.close(); }
 });
});
