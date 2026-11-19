/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { getDesktopPhotoDevelopAvailabilityCurrentV1 as availability } from '../../src/lightscaper/desktop-photo-develop-availability-current-v1.ts';
import { linkedWorkflowFixtureCurrentV1 as actual, options, hash, remainsPending } from './lightscaper-native-linked-workflow-integration-fixture-current.ts';
import { deferred } from './async-test-control.ts';
import type { TestContext } from 'node:test';
export { options, hash, remainsPending };
type Fixture = Parameters<Parameters<typeof actual>[1]>[0];
export async function offlineLinkedDevelopFixtureCurrentV1(context: TestContext, run: (f: Awaited<ReturnType<typeof seed>>) => Promise<void>): Promise<void> {
	await actual(context, async fixture => { await run(await seed(fixture)); });
}
async function seed(f: Fixture) {
	const file = await f.file(), { session, runtime } = await f.open(), selected = await f.select(runtime);
	let items: Awaited<ReturnType<typeof runtime.importEntries>>;
	try { items = await f.track(runtime.importEntries({ scan: selected.scan, entryIds: [selected.entry.entryId] })); }
	finally { await runtime.closeScan(selected.scan); }
	const photoId = items[0]?.photoId; assert.ok(photoId);
	const photo = await f.catalog.loadPhoto(f.catalogId, photoId); assert.ok(photo);
	const cached = await f.track(session.readPreview(photoId, 'fit-screen', { expectedRevision: photo.revision }));
	assert.equal(cached.outcome, 'ready');
	const source = availability(session.develop); assert.ok(source, 'Complete genuine native Session must register its availability facet.');
	return { ...f, file, session, runtime, photoId, revision: photo.revision, photo, cached, source };
}
/** Holds only delivery of an actual completed Main inspection, never replaces
 * native file authentication. Restore the prototype only after all work joins. */
export function holdOfflineDevelopInspectionCurrentV1(context: TestContext) {
	const descriptor = Object.getOwnPropertyDescriptor(Main.prototype, 'dispatch'); assert.ok(descriptor);
	const dispatch = Main.prototype.dispatch, entered = deferred<void>(), gate = deferred<void>();
	let observed = false, armed = true;
	Object.defineProperty(Main.prototype, 'dispatch', { ...descriptor, value: function (this: Main, ...args: Parameters<Main['dispatch']>): ReturnType<Main['dispatch']> {
		const result = Reflect.apply(dispatch, this, args) as ReturnType<Main['dispatch']>;
		const payload = args[2], packet = payload && typeof payload === 'object' ? Object.getOwnPropertyDescriptor(payload, 'payload')?.value as unknown : undefined;
		const operation = packet && typeof packet === 'object' ? Object.getOwnPropertyDescriptor(packet, 'operation')?.value as unknown : undefined;
		if (armed && operation === 'inspect-original') return result.then(async value => { armed = false; observed = true; entered.resolve(); await gate.promise; return value; });
		return result;
	} });
	const release = (): void => { gate.resolve(); entered.resolve(); };
	context.signal.addEventListener('abort', release, { once: true });
	return { entered: entered.promise, get observed() { return observed; }, release,
		restore(): void { release(); context.signal.removeEventListener('abort', release); Object.defineProperty(Main.prototype, 'dispatch', descriptor); } };
}
