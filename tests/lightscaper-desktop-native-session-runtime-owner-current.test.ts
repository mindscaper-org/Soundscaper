/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopPhotoLibrarySessionCurrentV1 as create } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import { PhotoLibrarySessionCurrentV1 as Session } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import { PhotoLibrarySessionKernelV2 as Kernel } from '../src/lightscaper/controller/photo-library-session-kernel-v2.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service } from '../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';

const options = { timeout: 15_000 };

void test('Native Current factory retains actual class prototype and closes its real inner kernel exactly once', options, async context => {
	await fixture(context, async f => {
		const original = Kernel.prototype.close; let innerCloses = 0;
		Kernel.prototype.close = function () { assert.ok(this instanceof Session); innerCloses++; return Reflect.apply(original, this, []) as Promise<void>; };
		let session: Session | undefined;
		try {
			session = await f.open(); assert.ok(session instanceof Session); assert.equal(Object.getPrototypeOf(session), Session.prototype);
			assert.equal(Object.hasOwn(session, 'close'), true); const page = await session.readPage(); assert.equal(page.totalCount, f.photos.length);
			const closing = session.close(); assert.equal(session.close(), closing); await closing; assert.equal(innerCloses, 1);
			await assert.rejects(session.readPage());
		} finally { await session?.close(); Kernel.prototype.close = original; }
	});
});

void test('Native local construction close does not await the remote native lease admission that is waiting for it', options, async context => {
	await fixture(context, async f => {
		let local: Readonly<{ close(): Promise<void> }> | undefined, localClosing: Promise<void> | undefined, localRetired = false;
		const rescue = f.gate();
		const service: Service = { open(input, owner) { assert.equal(this, service); local = owner; return f.service.open(input, owner); } };
		f.hooks.opened = async () => {
			assert.ok(local); localClosing = local.close(); void localClosing.catch(() => undefined);
			// Deadline releases only this control waiter. The actual local close
			// and factory/native admission remain owned and are joined below.
			await Promise.race([localClosing, rescue.promise]); localRetired = true;
		};
		const work = f.track(create({ name: 'Actual native opening barrier', service, originalSourceOptions: { storage: f.storage.storage } }));
		try { await assert.rejects(work); assert.equal(localRetired, true); await localClosing; assert.equal(f.storage.counts().stages, 0); }
		finally { rescue.release(); await Promise.allSettled([work, localClosing]); }
		const components = await f.scopes.openComponents(f.selected.scope); await components.close();
	});
});

void test('Native Current factory joins actual constructor reentry before local Source or physical owners can retire', options, async context => {
	await fixture(context, async f => {
		const original = Kernel.prototype.close, inners: Kernel[] = []; let closes = 0, reflections = 0;
		let localClosing: Promise<void> | undefined;
		Kernel.prototype.close = function () { inners.push(this); closes++; return Reflect.apply(original, this, []) as Promise<void>; };
		const service: Service = { async open(input, owner) {
			const actual = await f.service.open(input, owner), catalog = { ...actual.components.catalog };
			const save = actual.components.catalog.savePhoto;
			Object.defineProperty(catalog, 'savePhoto', { enumerable: true, get() {
				reflections++; localClosing = owner.close(); void localClosing.catch(() => undefined); return save;
			} });
			return Object.freeze({ ...actual, components: Object.freeze({ ...actual.components, catalog }) });
		} };
		const work = f.track(create({ name: 'Actual Current constructor reentry', service, originalSourceOptions: { storage: f.storage.storage } }));
		try {
			await assert.rejects(work); assert.ok(reflections >= 1); await localClosing;
			assert.ok(inners[0] instanceof Session, 'The actual Current constructor must finish and its original kernel Close must join.');
			assert.equal(closes, 1); assert.equal(f.storage.counts().stages, 0);
		} finally { await Promise.allSettled([work, localClosing]); Kernel.prototype.close = original; }
		const components = await f.scopes.openComponents(f.selected.scope); await components.close();
	});
});
