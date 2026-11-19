/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';

async function fixture(t: TestContext, run: (scopes: Scopes, directory: string, release: () => void, held: Promise<void>) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-session-admission-'));
	const scopes = await Scopes.open({ appDataPath: directory });
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const deadline = setTimeout(() => { release(); }, 15_000);
	t.signal.addEventListener('abort', release, { once: true });
	try { await run(scopes, directory, release, held); }
	finally { release(); clearTimeout(deadline); t.signal.removeEventListener('abort', release); await scopes.close(); await rm(directory, { recursive: true }); }
}

void test('Native Session admission requires a genuine selected scope before local owner reflection', { timeout: 15_000 }, async t => {
	await fixture(t, async scopes => {
		const ordinary = await scopes.openDefault(); let touched = 0;
		const poison = new Proxy({ close: async (): Promise<void> => undefined }, { get() { touched++; throw new Error('Unowned local owner'); } });
		await assert.rejects(scopes.openSessionLease(ordinary, poison));
		await assert.rejects(scopes.openSessionLease(Object.freeze({}), poison));
		assert.equal(touched, 0);
	});
});

void test('Native selected Session owns one role until real local retirement and physical close join', { timeout: 15_000 }, async t => {
	await fixture(t, async (scopes, directory, release, held) => {
		const selected = await scopes.openSelected({ name: 'Selected Session' });
		let closes = 0;
		const lease = await scopes.openSessionLease(selected.scope, { async close() { closes++; await held; } });
		assert.equal(lease.catalogId, selected.catalogId); assert.equal(lease.selectionToken, selected.selectionToken);
		let touched = 0;
		const poison = new Proxy({ close: async (): Promise<void> => undefined }, { get() { touched++; throw new Error('Second role'); } });
		await assert.rejects(scopes.openSessionLease(selected.scope, poison)); assert.equal(touched, 0);
		const closing = lease.close(); assert.equal(lease.close(), closing); assert.equal(lease.signal.aborted, true);
		await assert.rejects(Scopes.open({ appDataPath: directory }));
		await assert.rejects(scopes.openSessionLease(selected.scope, poison)); assert.equal(touched, 0);
		release(); await closing; assert.equal(closes, 1);
		const next = await scopes.openSessionLease(selected.scope, { close: async () => undefined }); await next.close();
	});
});

void test('Native Session captures local retirement and fences escaped settings, cache and resource facades', { timeout: 15_000 }, async t => {
	await fixture(t, async scopes => {
		const selected = await scopes.openSelected({ name: 'Facades' }); let closed = 0;
		const local = { close: async (): Promise<void> => { closed++; } };
		const lease = await scopes.openSessionLease(selected.scope, local);
		const settings = lease.components.settings.settingsRepository;
		const cube = await lease.components.resources.cubeLutResources();
		const load = lease.components.catalog.loadCatalog;
		local.close = async () => { throw new Error('Replacement must not run'); };
		lease.stop(); let touched = 0;
		const poison = new Proxy({}, { ownKeys() { touched++; throw new Error('Stopped input'); }, get() { touched++; throw new Error('Stopped input'); } });
		await assert.rejects(settings.put('stopped', poison));
		await assert.rejects(cube.verifyPhoto(poison));
		await assert.rejects(load(selected.catalogId));
		await assert.rejects(Reflect.apply(lease.components.originalTickets.transport.open, lease.components.originalTickets.transport, [poison]) as Promise<unknown>);
		assert.equal(touched, 0); await lease.close(); assert.equal(closed, 1);
	});
});

void test('Native Session admission excludes existing selected components and unselected aliases of its physical namespace', { timeout: 15_000 }, async t => {
	await fixture(t, async scopes => {
		const ordinary = await scopes.openDefault(), selected = await scopes.openSelected({ name: 'One component owner' });
		const components = await scopes.openComponents(selected.scope); let touched = 0;
		const poison = new Proxy({ close: async (): Promise<void> => undefined }, { get() { touched++; throw new Error('Existing component owner'); } });
		await assert.rejects(scopes.openSessionLease(selected.scope, poison)); assert.equal(touched, 0); await components.close();
		const defaultComponents = await scopes.openComponents(ordinary);
		await assert.rejects(scopes.openSessionLease(selected.scope, poison)); assert.equal(touched, 0); await defaultComponents.close();
		const lease = await scopes.openSessionLease(selected.scope, { close: async () => undefined });
		await assert.rejects(scopes.openComponents(ordinary)); await lease.close();
	});
});

void test('Native manager reentry during local retirement capture joins admission cleanup before exclusion release', { timeout: 15_000 }, async t => {
	await fixture(t, async (scopes, directory) => {
		const selected = await scopes.openSelected({ name: 'Capture reentry' });
		let closing: Promise<void> | undefined, localCloses = 0;
		const owner = { get close(): () => Promise<void> {
			closing = scopes.close(); return async () => { localCloses++; };
		} };
		await assert.rejects(scopes.openSessionLease(selected.scope, owner)); assert.ok(closing); await closing;
		assert.equal(localCloses, 1);
		const reopened = await Scopes.open({ appDataPath: directory }); await reopened.close();
	});
});

void test('Native Session opening preserves first opaque cancellation when local close capture aborts and throws', { timeout: 15_000 }, async t => {
	await fixture(t, async scopes => {
		const selected = await scopes.openSelected({ name: 'Opening cancellation' }), controller = new AbortController();
		const reason = Symbol('first opening cancellation'), borrowed = Symbol('later borrowed failure');
		const owner = { get close(): () => Promise<void> { controller.abort(reason); throw borrowed; } };
		await assert.rejects(scopes.openSessionLease(selected.scope, owner, { signal: controller.signal }), failure => { assert.equal(failure, reason); return true; });
	});
});

void test('Native manager close joins the captured local Session barrier before guard release', { timeout: 15_000 }, async t => {
	await fixture(t, async (scopes, directory, release, held) => {
		const selected = await scopes.openSelected({ name: 'Manager close' });
		let entered = false;
		const lease = await scopes.openSessionLease(selected.scope, { async close() { entered = true; await held; } });
		const closing = scopes.close(); assert.equal(scopes.close(), closing);
		await new Promise<void>(resolve => { setImmediate(resolve); });
		assert.equal(entered, true); assert.equal(lease.signal.aborted, true);
		await assert.rejects(Scopes.open({ appDataPath: directory }));
		release(); await closing;
		const reopened = await Scopes.open({ appDataPath: directory }); await reopened.close();
	});
});
