/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLinkedGrantsCurrentV1 as Grants } from '../../desktop/lightscaper-native-photo-linked-grants-current-v1.ts';
import { nativeGrantedFilesystemFixtureCurrentV1, grantedFsPathCurrentV1, grantedFsHashCurrentV1,
	GRANTED_FS_OP } from './lightscaper-native-granted-filesystem-fixture-current.ts';
export { Grants, GRANTED_FS_OP, grantedFsPathCurrentV1, grantedFsHashCurrentV1 };
export { remainsPending } from './async-test-control.ts';
export const LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 = Object.freeze({ concurrency: false, timeout: 15000 });
type Owner = Awaited<ReturnType<typeof Grants.open>>;
type Selection = Awaited<ReturnType<Parameters<typeof Grants.open>[0]['chooser']['chooseRoot']>>;
type NativeFixture = Parameters<Parameters<typeof nativeGrantedFilesystemFixtureCurrentV1>[1]>[0];
type Options = Readonly<{ signal?: AbortSignal }>;
export type Grant = NonNullable<Awaited<ReturnType<Owner['authorize']>>>;

/** This fixture proves the actual native role/media namespace boundary. Its
 * trusted local controller is not a public selected-epoch or body proof. */
export async function linkedGrantsFixtureCurrentV1(context: TestContext,
	run: (fixture: ReturnType<typeof createFixture>) => Promise<void>): Promise<void> {
	await nativeGrantedFilesystemFixtureCurrentV1(context, async native => {
		const fixture = createFixture(context, native); let failed = false, primary: unknown;
		try { await run(fixture); } catch (error) { failed = true; primary = error; }
		const errors: unknown[] = [];
		try { await fixture.close(); } catch (error) { errors.push(error); }
		if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Grant fixture did not retire actual work.', { cause: errors[0] });
		if (failed) throw primary;
	});
}
function createFixture(context: TestContext, native: NativeFixture) {
	const nativeOwners: Array<Readonly<{ close(): Promise<void> }>> = [];
	const controller = new AbortController(), owners: Owner[] = [], gates = new Set<() => void>(), work = new Set<Promise<unknown>>();
	let closing: Promise<void> | undefined, notified = 0, expired = false;
	const scope = Object.freeze({ signal: controller.signal, assertCurrent(): void { controller.signal.throwIfAborted(); } });
	const appDataPath = join(native.directory, 'app-data');
	const databasePath = join(appDataPath, 'Lightscaper', 'project-library', 'v1', 'native-photo-linked-grants.sqlite3');
	const selected = Object.freeze({ path: grantedFsPathCurrentV1(native.rootPath), displayName: 'Native folder' });
	const release = (): void => { for (const retire of gates) retire(); };
	const stop = (): void => { release(); controller.abort(context.signal.reason); for (const owner of owners) void owner.close().catch(() => undefined); };
	context.signal.addEventListener('abort', stop, { once: true }); if (context.signal.aborted) stop();
	const timer = setTimeout(() => { expired = true; stop(); }, 13000);
	const track = <Value>(accepted: Promise<Value>): Promise<Value> => {
		work.add(accepted); void accepted.then(() => { work.delete(accepted); }, () => { work.delete(accepted); }); return native.track(accepted);
	};
	return {
		...native, appDataPath, databasePath, scope, selected, release, track,
		notifications: (): number => notified,
		own(owner: Owner): Owner { owners.push(owner); return owner; },
		ownNative<Value extends Readonly<{ close(): Promise<void> }>>(owner: Value): Value { nativeOwners.push(owner); return owner; },
		async root() { const root = await native.root(); nativeOwners.push(root); return root; },
		async open(chooseRoot: (signal?: AbortSignal) => Promise<Selection> = async () => selected): Promise<Owner> {
			const owner = await Grants.open({ appDataPath, filesystem: native.role, chooser: { chooseRoot }, scope,
				unretired: () => { notified++; } }); owners.push(owner); return owner;
		},
		hold() { const gate = native.hold(); gates.add(gate.release); return gate; },
		holdNext(opcode: number) {
			const selected = native.hold(opcode); gates.add(selected.release);
			return Object.freeze({ entered: selected.entered, release: selected.release, restore(): void { /* Existing source-bound wire observer stays installed. */ } });
		},
		gate() {
			let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; });
			gates.add(release); return Object.freeze({ promise, release });
		},
		peer(): DatabaseSync { return new DatabaseSync(databasePath, { allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 }); },
		async reached(barrier: Promise<void>, accepted: Promise<unknown>): Promise<void> {
			await Promise.race([barrier, accepted.then(() => { throw new Error('Grant operation ended before the actual native barrier.'); }, error => { throw error; })]);
			context.signal.throwIfAborted();
		},
		close(): Promise<void> {
			closing ??= Promise.resolve().then(async () => {
				release(); const results = await Promise.allSettled(owners.map(owner => owner.close()));
				await Promise.allSettled([...work]);
				const retiredNative = await Promise.allSettled(nativeOwners.slice().reverse().map(owner => owner.close()));
				clearTimeout(timer); context.signal.removeEventListener('abort', stop);
				const errors = [...results, ...retiredNative].flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
				if (expired) errors.push(new Error('Grant test active deadline expired after releasing and joining real work.'));
				if (errors.length) throw new AggregateError(errors, 'Grant native owners did not retire.', { cause: errors[0] });
			}); return closing;
		},
	};
}
export async function invokeGrantUnknownCurrentV1(owner: Owner | typeof Grants, name: string, args: readonly unknown[]): Promise<unknown> {
	const method: unknown = Reflect.get(owner, name); assert.ok(typeof method === 'function');
	const value: unknown = Reflect.apply(method, owner, args); assert.ok(value instanceof Promise); return value;
}
export function grantProjectionCurrentV1(value: Grant): void {
	assert.deepEqual(Object.keys(value).sort(), ['displayName', 'grantId', 'revision', 'revoked']);
	assert.match(value.grantId, /^[0-9a-f]{64}$/u); assert.equal(Object.isFrozen(value), true);
	assert.equal(typeof value.displayName, 'string'); assert.equal(Number.isSafeInteger(value.revision), true); assert.equal(typeof value.revoked, 'boolean');
}
export async function grantAuthorizeCurrentV1(owner: Owner, options?: Options): Promise<Grant> {
	const result = await owner.authorize(options); assert.ok(result); grantProjectionCurrentV1(result); return result;
}
