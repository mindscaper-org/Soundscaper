/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopPhotoLibrarySessionCurrentV1 as create } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service } from '../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';

for (const point of ['service', 'storage'] as const) void test(`Native Current ${point} capture preserves known opaque cancellation before a later getter failure`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const controller = new AbortController(), primary = Symbol('actual opening cancellation'), secondary = Symbol('later borrowed reflection');
		let reflected = 0;
		const fail = (): never => { reflected++; controller.abort(primary); throw secondary; };
		const service: Service = point === 'service' ? { get open() { return fail(); } } : f.service;
		const storage = point === 'storage' ? { get getDirectory() { return fail(); } } : f.storage.storage;
		const work = f.track(create({ name: 'Native capture cancellation', service, signal: controller.signal, originalSourceOptions: { storage } }));
		try {
			await assert.rejects(work, reason => Object.is(reason, primary));
			assert.equal(reflected, 1); assert.equal(f.counts().opens, 0); assert.equal(f.storage.counts().stages, 0);
		} finally { await Promise.allSettled([work]); }
		const components = await f.scopes.openComponents(f.selected.scope); await components.close();
	});
});
