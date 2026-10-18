/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitPhotoCullingNavigationV1 } from '../src/lightscaper/catalog/photo-culling-navigation-contract-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';

export type AdmittedLightscaperNativeCullingNavigationCurrentV1 = ReturnType<typeof admitPhotoCullingNavigationV1> & Readonly<{ catalogId: string }>;
const packets = new WeakSet<AdmittedLightscaperNativeCullingNavigationCurrentV1>();
const NativeController = AbortController, nativeAbort = NativeController.prototype.abort;
const nativeSignal = Object.getOwnPropertyDescriptor(NativeController.prototype, 'signal')!.get!;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;

/** Capture the closed request once before queue waits. The optional signal is
 * the main-private owner's shutdown authority, never a renderer request field.
 * Admission's short-lived link uses intrinsic behavior even when a context
 * Proxy adds signal shadows or requests shutdown during normalization. */
export function admitLightscaperNativeCullingNavigationCurrentV1(catalogValue: unknown, contextValue: unknown,
	requestValue: unknown, ownerSignal?: AbortSignal): AdmittedLightscaperNativeCullingNavigationCurrentV1 {
	let caller: AbortSignal | undefined, joined: AbortSignal | undefined, dispose: (() => void) | undefined;
	try {
		const catalogId = id(catalogValue, 'native culling catalog ID');
		const input = record(requestValue, 'native culling request', ['photoId', 'signal'], ['photoId']);
		const value = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
		if (value !== undefined) {
			// Establish native identity without invoking an own aborted accessor;
			// the owning validator retains native reason/override precedence.
			Reflect.apply(nativeAborted, value, []); caller = value as AbortSignal;
			assertPhotoStackQuerySignalV1(caller);
		}
		const link = linkAdmission(caller, ownerSignal); joined = link.signal; dispose = link.dispose; check(joined);
		const request = admitPhotoCullingNavigationV1(contextValue, Object.freeze({ photoId: field(input, 'photoId'),
			...(caller === undefined ? {} : { signal: caller }) }));
		check(joined);
		const result = Object.freeze({ catalogId, ...request }); packets.add(result); return result;
	} catch (error) {
		// Once joined, the first actual event owns the reason. Before that,
		// only already admitted native identities can supply abort authority.
		if (joined !== undefined) check(joined);
		else { check(caller); check(ownerSignal); }
		throw error;
	} finally { dispose?.(); }
}

export function readAdmittedLightscaperNativeCullingNavigationCurrentV1(value: unknown): AdmittedLightscaperNativeCullingNavigationCurrentV1 {
	if (value === null || typeof value !== 'object' || !packets.has(value as AdmittedLightscaperNativeCullingNavigationCurrentV1)) {
		throw new TypeError('Native culling requires its genuine owning admitted request.');
	}
	return value as AdmittedLightscaperNativeCullingNavigationCurrentV1;
}

function linkAdmission(caller: AbortSignal | undefined, owner: AbortSignal | undefined): Readonly<{ signal: AbortSignal; dispose: () => void }> {
	const controller = new NativeController(), links: { readonly source: AbortSignal; readonly forward: () => void }[] = [];
	const dispose = (): void => { for (const link of links) Reflect.apply(nativeRemove, link.source, ['abort', link.forward]); };
	try {
		for (const source of [caller, owner]) {
			if (source === undefined) continue;
			Reflect.apply(nativeAborted, source, []);
			const forward = (): void => { const reason: unknown = Reflect.apply(nativeReason, source, []); Reflect.apply(nativeAbort, controller, [reason]); };
			Reflect.apply(nativeAdd, source, ['abort', forward, { once: true }]); links.push({ source, forward });
			if (Reflect.apply(nativeAborted, source, []) === true) forward();
		}
		return Object.freeze({ signal: Reflect.apply(nativeSignal, controller, []) as AbortSignal, dispose });
	} catch (error) { dispose(); throw error; }
}
function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
