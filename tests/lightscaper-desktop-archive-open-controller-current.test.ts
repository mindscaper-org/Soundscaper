/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperDesktopArchiveOpenCurrentV1, type LightscaperDesktopArchiveOpenOptionsCurrentV1 } from '../src/common/editor/controller/composition/lightscaper-desktop-archive-open-current-v1.ts';
import type { DesktopLightscaperArchiveOpenBridgeCurrentV1, DesktopLightscaperArchiveOpenDescriptorCurrentV1 } from '../src/common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';
import { DESKTOP_READ_PROFILE_SCAPE_RANGE, DESKTOP_SCAPE_MIME_TYPE } from '../src/common/editor/desktop-read-profile.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

function source(letter = 'a') {
	const file = new File(['archive'], `${letter}.liscape`), id = letter.repeat(64);
	const descriptor: DesktopLightscaperArchiveOpenDescriptorCurrentV1 = { id, name: file.name, size: file.size,
		url: `lightscaper-app://bundle/_desktop/read/${DESKTOP_READ_PROFILE_SCAPE_RANGE}/${id}/${file.name}`,
		mimeType: DESKTOP_SCAPE_MIME_TYPE, readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE, lastModified: 0 };
	let closes = 0;
	return { descriptor, file, resource: { file, close: async () => { closes++; } }, closes: () => closes };
}
function nativeBridge(queue: readonly Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1>[] = []) {
	const pending = [...queue], listeners = new Set<() => void>(), retiredListeners: (() => void)[] = [];
	let takes = 0;
	const bridge: DesktopLightscaperArchiveOpenBridgeCurrentV1 = {
		takeArchive: async () => { takes++; return pending.shift() ?? null; }, finishArchive: async () => {},
		onArchiveAvailable(listener) { listeners.add(listener); return () => { listeners.delete(listener); retiredListeners.push(listener); }; },
	};
	return { bridge, wake: () => { for (const listener of listeners) listener(); }, takes: () => takes, retiredListeners };
}
function owner(options: Partial<LightscaperDesktopArchiveOpenOptionsCurrentV1> = {}, queue = source()) {
	const native = nativeBridge([queue.descriptor]), files: (File | null)[] = [], errors: unknown[] = [];
	let presented = 0, retired = 0;
	const current = new LightscaperDesktopArchiveOpenCurrentV1({ bridge: native.bridge,
		load: async () => queue.resource, canPresent: () => true, onFile: file => { files.push(file); },
		onPresent: () => { presented++; }, retireRestore: async () => { retired++; },
		reportError: error => { errors.push(error); }, ...options });
	return { current, native, files, errors, source: queue, presented: () => presented, retired: () => retired };
}

test('Lightscaper OS-open queues behind unsafe UI and only presents explicit confirmation', async () => {
	let safe = false;
	const value = owner({ canPresent: () => safe }); value.current.mount();
	await settle(); value.native.wake(); value.current.tick(); await settle();
	assert.equal(value.native.takes(), 0); assert.deepEqual(value.files, []);
	safe = true; value.current.tick(); await settle();
	assert.equal(value.native.takes(), 1); assert.equal(value.presented(), 1);
	assert.deepEqual(value.files, [value.source.file]); assert.equal(value.retired(), 0);
	await value.current.dismiss(); assert.equal(value.source.closes(), 1);
	await value.current.retireAndJoin();
});

test('Lightscaper materialization does not overwrite a dialog opened during loading', async () => {
	const selected = source(), loading = deferred<Readonly<typeof selected.resource>>(); let safe = true;
	const value = owner({ canPresent: () => safe, load: async () => loading.promise }, selected);
	value.current.mount(); await settle(); assert.equal(value.native.takes(), 1);
	safe = false; loading.resolve(selected.resource); await settle();
	assert.deepEqual(value.files, []); assert.equal(value.presented(), 0);
	await value.current.dismiss(); assert.equal(selected.closes(), 0);
	safe = true; value.current.tick(); await settle(); assert.deepEqual(value.files, [selected.file]);
	await value.current.dismiss(); await value.current.retireAndJoin(); assert.equal(selected.closes(), 1);
});

test('Lightscaper hide joins exact File consumers latched before reentrant callbacks and fences stale Restore', async () => {
	const value = owner(), held = deferred<string>(); value.current.mount(); await settle();
	let hiding: Promise<void> | undefined, calls = 0;
	const work = value.current.withFileConsumer(value.source.file, async () => {
		calls++; hiding = value.current.dismiss(); return held.promise;
	});
	await settle(); assert.equal(value.source.closes(), 0); assert.equal(await remainsPending(hiding!), true);
	await assert.rejects(value.current.withFileConsumer(value.source.file, async () => { calls++; return 'stale'; }), { name: 'AbortError' });
	held.resolve('durable-ack'); assert.equal(await work, 'durable-ack'); await hiding;
	assert.equal(calls, 1); assert.equal(value.source.closes(), 1); assert.deepEqual(value.files, [value.source.file, null]);
	await assert.rejects(value.current.withFileConsumer(value.source.file, async () => 'stale'), { name: 'AbortError' });
	await value.current.retireAndJoin();
});

test('Lightscaper unmount joins actual restore retirement and consumers before deleting staged File', async () => {
	const retiring = deferred<void>(), reading = deferred<void>(); let closeCalls = 0;
	const value = owner({ retireRestore: async () => { closeCalls++; await retiring.promise; } });
	value.current.mount(); await settle();
	const work = value.current.withFileConsumer(value.source.file, async () => reading.promise);
	const closing = value.current.retireAndJoin(); assert.equal(value.current.retireAndJoin(), closing);
	assert.equal(closeCalls, 1); reading.resolve(); await work; await settle();
	assert.equal(value.source.closes(), 0); assert.equal(await remainsPending(closing), true);
	retiring.resolve(); await closing; assert.equal(value.source.closes(), 1);
});

test('Lightscaper retires an issued descriptor arriving after unmount without admitting its File', async () => {
	const descriptor = deferred<Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> | null>(); let finished = 0;
	const selected = source(), native = nativeBridge();
	const value = owner({ bridge: { ...native.bridge, takeArchive: async () => descriptor.promise },
		load: async (value, signal) => { assert.equal(value.id, selected.descriptor.id); assert.equal(signal.aborted, true); finished++; throw signal.reason; } });
	value.current.mount(); await settle(); const closing = value.current.retireAndJoin();
	descriptor.resolve(selected.descriptor); await closing;
	assert.equal(finished, 1); assert.deepEqual(value.files, []); assert.deepEqual(value.errors, []); assert.equal(value.retired(), 0);
});

test('Lightscaper joins a late File materializer even if it ignores cancellation', async () => {
	const selected = source(), loading = deferred<Readonly<typeof selected.resource>>();
	const value = owner({ load: async () => loading.promise }, selected); value.current.mount(); await settle();
	const closing = value.current.retireAndJoin(); assert.equal(await remainsPending(closing), true);
	loading.resolve(selected.resource); await closing;
	assert.equal(selected.closes(), 1); assert.deepEqual(value.files, []); assert.equal(value.retired(), 0);
});

test('Lightscaper StrictMode probe never takes or drops a queued native archive; retired events stay inert', async () => {
	const selected = source(), native = nativeBridge([selected.descriptor]);
	const first = owner({ bridge: native.bridge }, selected); first.current.mount(); const probing = first.current.retireAndJoin();
	const second = owner({ bridge: native.bridge }, selected); second.current.mount(); await probing; await settle();
	assert.equal(native.takes(), 1); assert.equal(first.retired(), 0); assert.deepEqual(first.files, []);
	assert.deepEqual(second.files, [selected.file]);
	for (const event of native.retiredListeners) event(); await settle(); assert.equal(native.takes(), 1);
	await second.current.retireAndJoin(); assert.equal(selected.closes(), 1);
});

test('Lightscaper failed restore retirement retains its source instead of swallowing a failed join', async () => {
	const failure = new Error('native reader join failed');
	const value = owner({ retireRestore: async () => { throw failure; } }); value.current.mount(); await settle();
	await assert.rejects(value.current.retireAndJoin(), error => error === failure);
	assert.equal(value.source.closes(), 0);
});

test('Lightscaper drains coalesced queued requests without a second event and preserves a manual File', async () => {
	const first = source('a'), second = source('b'), native = nativeBridge([first.descriptor, second.descriptor]);
	let safe = true;
	const value = owner({ bridge: native.bridge, canPresent: () => safe,
		load: async descriptor => descriptor.id === first.descriptor.id ? first.resource : second.resource });
	value.current.mount(); await settle(); assert.equal(native.takes(), 1);
	const manual = new File(['manual'], 'selected.scape');
	assert.equal(await value.current.withFileConsumer(manual, async file => file), manual);
	safe = false; await value.current.dismiss(); await settle(); assert.equal(first.closes(), 1); assert.equal(native.takes(), 1);
	safe = true; value.current.tick(); await settle(); assert.equal(native.takes(), 2);
	assert.equal(value.files.at(-1), second.file); await value.current.retireAndJoin(); assert.equal(second.closes(), 1);
});


test('Lightscaper latches terminal retirement before a borrowed close callback reenters', async () => {
	let reentered: Promise<void> | undefined;
	const value = owner({ retireRestore: () => { reentered = value.current.retireAndJoin(); return Promise.resolve(); } });
	value.current.mount(); await settle(); const closing = value.current.retireAndJoin();
	assert.equal(reentered, closing); await closing; assert.equal(value.source.closes(), 1);
});

test('Lightscaper reports real archive pending transitions through loading, exact consumers and physical release', async () => {
	const selected = source(), taking = deferred<DesktopLightscaperArchiveOpenDescriptorCurrentV1 | null>();
	const reading = deferred<string>(), releasing = deferred<void>(), transitions: boolean[] = [];
	let safe = true;
	const value = owner({ canPresent: () => safe,
		bridge: { ...nativeBridge().bridge, takeArchive: async () => taking.promise },
		load: async () => ({ file: selected.file, close: async () => releasing.promise }),
		onPendingChange: () => { transitions.push(value.current.isPending()); },
	}, selected);
	value.current.mount(); await settle(); assert.deepEqual(transitions, [true]);
	taking.resolve(selected.descriptor); await settle(); assert.deepEqual(transitions, [true, false]);
	const work = value.current.withFileConsumer(selected.file, async () => reading.promise);
	assert.deepEqual(transitions, [true, false, true]);
	reading.resolve('read'); assert.equal(await work, 'read');
	assert.deepEqual(transitions, [true, false, true, false]);
	safe = false; const hiding = value.current.dismiss();
	assert.deepEqual(transitions, [true, false, true, false, true]);
	await settle(); assert.equal(value.current.isPending(), true);
	releasing.resolve(); await hiding;
	assert.deepEqual(transitions, [true, false, true, false, true, false]);
	await value.current.retireAndJoin(); assert.deepEqual(value.errors, []);
});

test('A throwing archive pending observer cannot cancel custody, suppress task handlers or clear failed physical release', async () => {
	const observerFailure = new Error('Observer failed.'), releaseFailure = new Error('Native reader failed to retire.');
	const value = owner({ onPendingChange: () => { throw observerFailure; },
		load: async () => ({ file: value.source.file, close: async () => { throw releaseFailure; } }),
	});
	value.current.mount(); await settle(); assert.equal(value.presented(), 1);
	assert.equal(await value.current.withFileConsumer(value.source.file, async () => 'read'), 'read');
	await assert.rejects(value.current.dismiss(), error => error === releaseFailure);
	assert.equal(value.current.isPending(), true);
	await assert.rejects(value.current.retireAndJoin(), error => error === releaseFailure);
	assert.ok(value.errors.includes(observerFailure));
});
