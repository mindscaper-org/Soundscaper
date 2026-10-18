/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { openNativeOriginalBrowserFixtureCurrentV1 } from './browser/helpers/lightscaper-native-original-transport-fixture-current.ts';
import type { NativeOriginalBrowserCaseCurrentV1 } from './browser/lightscaper-native-original-transport-current.spec.ts';
import type { NativeOriginalGroupBrowserCaseCurrentV1 } from './browser/lightscaper-original-group-current.spec.ts';
import { readDesktopPhotoOriginalGroupTicketCurrentV1 } from '../src/lightscaper/desktop-photo-original-group-contract-current-v1.ts';
import { readDesktopPhotoOriginalTicketCurrentV1, type DesktopPhotoOriginalTicketCurrentV1 } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';

test('Lightscaper browser raster fixture is genuinely published, range authenticated and deletion-pinned by its actual native ticket', async () => {
	const kind: NativeOriginalBrowserCaseCurrentV1['kind'] = 'raster', fixture = await openNativeOriginalBrowserFixtureCurrentV1(kind);
	let ticket: Readonly<DesktopPhotoOriginalTicketCurrentV1> | undefined, failed = false, primary: unknown;
	const cleanup: unknown[] = [];
	try {
		assert.ok(fixture.byteLength > 1024 * 1024 && fixture.byteLength < 2 * 1024 * 1024);
		ticket = readDesktopPhotoOriginalTicketCurrentV1(await fixture.transport.open(fixture.request), fixture.request);
		const hash = createHash('sha256'); let pulls = 0;
		for (let offset = 0; offset < fixture.byteLength;) {
			const length = Math.min(1024 * 1024, fixture.byteLength - offset), bytes = await fixture.transport.read(ticket, offset, length);
			assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.byteLength, length); hash.update(bytes); bytes.fill(0); offset += length; pulls++;
		}
		assert.equal(hash.digest('hex'), fixture.sha256); assert.equal(pulls, 2); await fixture.provePinned();
		await fixture.transport.close({ id: ticket.id }); ticket = undefined; await fixture.proveReleased();
	} catch (error) { failed = true; primary = error; }
	if (ticket) try { await fixture.transport.close({ id: ticket.id }); } catch (error) { cleanup.push(error); }
	try { await fixture.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native browser fixture did not retire.');
	if (failed) throw primary;
});

test('Lightscaper browser group fixture authenticates both independent locators and releases both actual native pins', { timeout: 15_000 }, async context => {
	const selected: NativeOriginalGroupBrowserCaseCurrentV1 = { kind: 'raster', aliases: true };
	const fixture = await openNativeOriginalBrowserFixtureCurrentV1(selected.kind, { aliases: selected.aliases });
	const cancel = (): void => { void fixture.retireNative().catch(() => undefined); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	let id: string | undefined, failed = false, primary: unknown; const cleanup: unknown[] = [];
	try {
		const { openGroup, readGroup, closeGroup } = fixture.transport;
		assert.ok(openGroup && readGroup && closeGroup);
		assert.equal(fixture.requests.length, 2);
		assert.equal(new Set(fixture.requests.map(value => value.photoId)).size, 2);
		assert.equal(new Set(fixture.requests.map(value => value.original.storageKey)).size, 2);
		const ticket = readDesktopPhotoOriginalGroupTicketCurrentV1(await openGroup(fixture.requests), fixture.requests); id = ticket.id;
		for (let index = 0; index < fixture.requests.length; index++) {
			const hash = createHash('sha256');
			for (let offset = 0; offset < fixture.byteLength; offset += 1024 * 1024) {
				context.signal.throwIfAborted(); const length = Math.min(1024 * 1024, fixture.byteLength - offset);
				const bytes: unknown = await readGroup({ id }, index, offset, length); assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.byteLength, length);
				hash.update(bytes); bytes.fill(0);
			}
			assert.equal(hash.digest('hex'), fixture.sha256);
		}
		await fixture.provePinned(); await closeGroup({ id }); id = undefined; await fixture.proveReleased();
	} catch (error) { failed = true; primary = error; }
	if (id && fixture.transport.closeGroup) try { await fixture.transport.closeGroup({ id }); } catch (error) { cleanup.push(error); }
	try { await fixture.close(); } catch (error) { cleanup.push(error); }
	context.signal.removeEventListener('abort', cancel);
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native browser group fixture did not retire.');
	if (failed) throw primary;
});
