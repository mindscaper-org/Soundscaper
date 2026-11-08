/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers';
import { admitLightscaperNativeCullingNavigationCurrentV1, readAdmittedLightscaperNativeCullingNavigationCurrentV1,
	type AdmittedLightscaperNativeCullingNavigationCurrentV1 } from './lightscaper-native-culling-admission-current-v1.ts';
import { readLightscaperNativeCullingStepCurrentV1, type LightscaperNativeCullingProgressCurrentV1 } from './lightscaper-native-culling-step-current-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';

const nativeCheck = AbortSignal.prototype.throwIfAborted;

export function readLightscaperNativeCullingDestinationPageCurrentV1(database: DatabaseSync, catalogId: string,
	context: unknown, request: unknown): Promise<PhotoLibraryPageV1 | null> {
	return readAdmittedLightscaperNativeCullingDestinationPageCurrentV1(database, admitLightscaperNativeCullingNavigationCurrentV1(catalogId, context, request));
}

/** The queued owner lends its connection through this entire Promise. Its
 * private override is already caller+owner merged, never a renderer option.
 * Each phase and the actual event-loop yield are joined before cancellation
 * can return lifetime. There is no abandoned Promise.race or held transaction. */
export async function readAdmittedLightscaperNativeCullingDestinationPageCurrentV1(database: DatabaseSync,
	value: AdmittedLightscaperNativeCullingNavigationCurrentV1, signalOverride?: AbortSignal): Promise<PhotoLibraryPageV1 | null> {
	const request = readAdmittedLightscaperNativeCullingNavigationCurrentV1(value), signal = signalOverride ?? request.signal;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const progress: LightscaperNativeCullingProgressCurrentV1 = { proof: null, start: null, pending: null };
	while (true) {
		check(signal); const result = transaction(database, signal, () => readLightscaperNativeCullingStepCurrentV1(database, request, progress, signal));
		// Reads have no durable mutation ACK: cancellation during COMMIT must
		// prevent late scalar publication while writes keep their existing ACK.
		check(signal); if (result !== undefined) return result;
		await new Promise<void>(resolve => { setImmediate(resolve); });
		// The callback above has completed before this continuation runs. Close
		// joins the real turn; no timer can later reenter SQLite after settlement.
		check(signal);
	}
}
function transaction<Result>(database: DatabaseSync, signal: AbortSignal | undefined, read: () => Result): Result {
	check(signal); if (database.isTransaction) throw new Error('Native culling requires its own serialized snapshot.'); database.exec('BEGIN');
	try { const result = read(); check(signal); database.exec('COMMIT'); return result; }
	catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native culling read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeCheck, signal, []); }
