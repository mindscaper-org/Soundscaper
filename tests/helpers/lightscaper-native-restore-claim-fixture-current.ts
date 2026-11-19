/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test as nativeTest, type TestContext, type TestOptions } from 'node:test';
import { nativeScopeIntegrationFixtureCurrentV1 as nativeFixture, type Scopes } from './lightscaper-native-library-scope-integration-fixture-current.ts';
import { deferred as nativeDeferred } from './async-test-control.ts';
export { remainsPending } from './async-test-control.ts';
export { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
export { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from '../../desktop/lightscaper-native-catalog-store-current-v1.ts';
export interface Candidate {
	readonly allocation: Readonly<{ schemaVersion: 1; kind: 'photo-library-restore-allocation'; operationId: string; namespaceToken: string; ownerToken: string; catalogId: string }>;
	readonly catalogClaim: Readonly<object>; readonly mediaClaim: Readonly<object>;
	close(): Promise<void>;
	retireRole(kind: 'published' | 'unpublished' | 'protected'): void;
}
interface Ownership { readonly signal: AbortSignal; readonly releases: Set<() => void>; readonly owners: Set<() => Promise<void>> }
const ownership = new AsyncLocalStorage<Ownership>();
export function test(name: string, options: TestOptions, run: (context: TestContext) => Promise<void>): Promise<void> {
	return nativeTest(name, options, async context => {
		const state: Ownership = { signal: context.signal, releases: new Set(), owners: new Set() };
		const cancel = (): void => { for (const release of state.releases) release(); for (const close of state.owners) void close().catch(() => undefined); };
		context.signal.addEventListener('abort', cancel, { once: true });
		try { await ownership.run(state, () => run(context)); }
		finally { context.signal.removeEventListener('abort', cancel); cancel(); await Promise.allSettled([...state.owners].map(close => close())); }
	});
}
export function deferred() {
	const value = nativeDeferred<void>(), state = ownership.getStore(), release = (): void => { value.resolve(); };
	state?.releases.add(release); void value.promise.then(() => { state?.releases.delete(release); }, () => { state?.releases.delete(release); });
	if (state?.signal.aborted) release(); return value;
}
function track(owner: Readonly<{ close(): Promise<void> }>): void {
	const close = owner.close, retire = (): Promise<void> => Reflect.apply(close, owner, []) as Promise<void>;
	const state = ownership.getStore(); state?.owners.add(retire); if (state?.signal.aborted) void retire().catch(() => undefined);
}
export async function fixture(run: Parameters<typeof nativeFixture>[0]): Promise<void> {
	await nativeFixture(async f => { track(f.scopes); await run(f); });
}
export async function begin(scopes: Scopes, catalogId = 'restored-catalog', options: unknown = {}): Promise<Candidate> {
	const method: unknown = Reflect.get(scopes, 'beginRestore'); assert.equal(typeof method, 'function', 'Actual native Scopes must own fresh restore allocation.');
	const value = await Reflect.apply(method as (...args: unknown[]) => Promise<Candidate>, scopes, [catalogId, options]); track(value); return value;
}
export async function openComponent<Owner extends { close(): Promise<void> }>(claim: Readonly<object>, component: 'catalog' | 'media',
	open: (binding: Readonly<{ allocation: Candidate['allocation']; appDataPath: string; signal: AbortSignal; assertCurrent(): void }>) => Promise<Owner>): Promise<Owner> {
	// Node reaches this real production import only after genuine beginRestore
	// succeeded; baseline RED is the missing maintained Scopes capability.
	const module = await import('../../desktop/lightscaper-native-photo-library-restore-claim-current-v1.ts');
	return await module.openLightscaperNativePhotoLibraryRestoreComponentCurrentV1(claim, component, open);
}
export async function inspect(candidate: Candidate) {
	const module = await import('../../desktop/lightscaper-native-photo-library-restore-claim-current-v1.ts');
	return module.inspectLightscaperNativePhotoLibraryRestoreCandidateCurrentV1(candidate);
}
