/* SPDX-License-Identifier: AGPL-3.0-only */
import { open, type FileHandle } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import type { LightscaperNativePhotoUploadFileCurrentV1 as Upload } from '../../desktop/lightscaper-native-photo-upload-file-current-v1.ts';
import { assert, nativeOriginalInspectionFixtureCurrentV1 as base, INSPECTION_OPTIONS_CURRENT_V1,
	type InspectionFixtureCurrentV1 } from './lightscaper-native-original-inspection-fixture-current.ts';
import { deferred, remainsPending } from './async-test-control.ts';
export { assert, remainsPending, INSPECTION_OPTIONS_CURRENT_V1 as repairSourceOptionsCurrentV1 };
export type RepairSourceFixtureCurrentV1 = InspectionFixtureCurrentV1 & Readonly<{
	upload(bytes?: Uint8Array): Promise<Readonly<{ owner: Upload; proof: Readonly<object> }>>;
	begin(options?: unknown): Promise<Upload>;
	repair(proof: unknown, binding?: unknown, signal?: AbortSignal): Promise<unknown>;
	gate(mode: 'read' | 'close', consume: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<void>): Promise<void>;
}>;
export async function nativeRepairSourceFixtureCurrentV1(context: TestContext,
	consume: (fixture: RepairSourceFixtureCurrentV1) => Promise<void>): Promise<void> {
	await base(context, async f => {
		const owners = new Set<Upload>(), active = new Set<Promise<unknown>>(), releases = new Set<() => void>();
		const track = <T>(work: Promise<T>): Promise<T> => {
			active.add(work); void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return f.track(work);
		};
		const releaseAll = (): void => { for (const release of releases) release(); };
		context.signal.addEventListener('abort', releaseAll, { once: true });
		const begin = async (options: unknown = { expectedBytes: f.bytes.byteLength, expectedSha256: f.binding.sha256 }): Promise<Upload> => {
			const method: unknown = Reflect.get(f.media, 'beginOriginalRepairUploadCurrentV1');
			assert.equal(typeof method, 'function', 'Actual Media must create its namespace-owned repair upload.');
			const owner = await track(Reflect.apply(method as (options: unknown) => Promise<Upload>, f.media, [options])); owners.add(owner); return owner;
		};
		let failed = false, primary: unknown;
		try {
			await consume({ ...f, track, begin,
				upload: async (bytes = f.bytes) => {
					const owner = await begin();
					for (let offset = 0; offset < bytes.byteLength; offset += 1_048_576) await track(owner.write(new Uint8Array(bytes.subarray(offset, offset + 1_048_576))));
					return Object.freeze({ owner, proof: await track(owner.finish()) });
				},
				repair: (proof, binding = f.binding, signal = f.signal) => {
					const method: unknown = Reflect.get(f.media, 'restoreCatalogOriginalBodyFromSourceCurrentV1');
					assert.equal(typeof method, 'function', 'Actual Media must repair from its genuine completed upload.');
					return track(Reflect.apply(method as (...args: unknown[]) => Promise<unknown>, f.media, [binding, proof, { signal }]));
				},
				gate: async (mode, run) => {
					const witness = await open(f.path, 'r'), prototype = Object.getPrototypeOf(witness) as object;
					const descriptor = Object.getOwnPropertyDescriptor(prototype, 'read'); await witness.close();
					assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['read'];
					const entered = deferred<void>(), released = deferred<void>(); let selected = false;
					const changed: Array<Readonly<{ handle: FileHandle; descriptor: PropertyDescriptor | undefined }>> = [];
					const closing: Promise<void>[] = [];
					const release = (): void => { entered.resolve(); released.resolve(); }; releases.add(release);
					Object.defineProperty(prototype, 'read', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
						const receipt = Reflect.apply(native, this, args) as ReturnType<FileHandle['read']>;
						if (selected) return receipt; selected = true;
						if (mode === 'close') {
							const close = this.close; changed.push({ handle: this, descriptor: Object.getOwnPropertyDescriptor(this, 'close') });
							Object.defineProperty(this, 'close', { configurable: true, value: function (this: FileHandle): Promise<void> {
								const work = (async () => { entered.resolve(); await released.promise; await Reflect.apply(close, this, []); })(); closing.push(work); return work;
							} });
							return receipt;
						}
						return receipt.then(async value => { entered.resolve(); await released.promise; return value; });
					} });
					if (context.signal.aborted) release();
					try { await run({ entered: entered.promise, release }); }
					finally {
						release(); await Promise.allSettled([...active]); await Promise.allSettled(closing);
						for (const value of changed) {
							if (value.descriptor) Object.defineProperty(value.handle, 'close', value.descriptor); else Reflect.deleteProperty(value.handle, 'close');
						}
						Object.defineProperty(prototype, 'read', descriptor); releases.delete(release);
					}
				},
			});
		} catch (error) { failed = true; primary = error; }
		releaseAll(); await Promise.allSettled([...active]); const failures: unknown[] = [];
		for (const owner of owners) { try { await owner.close(); } catch (error) { failures.push(error); } }
		context.signal.removeEventListener('abort', releaseAll);
		if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Repair upload fixture failed real file retirement.');
		if (failed) throw primary;
	});
}
