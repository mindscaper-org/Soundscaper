/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueEntry } from '../src/common/editor/storage/key-value-repository.ts';
import type { PhotoCatalogImportExclusiveV1 } from '../src/lightscaper/import/catalog-write-lock-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { consumeLightscaperNativePhotoSessionClaimCurrentV1 as consume } from './lightscaper-native-photo-session-claim-current-v1.ts';
import { LightscaperNativePhotoLibraryExclusiveCurrentV1 as Exclusive } from './lightscaper-native-photo-library-exclusive-current-v1.ts';
import { LightscaperNativePhotoImportPresetsCurrentV1 as Presets, type LightscaperNativePhotoImportPresetRepositoryCurrentV1 as PresetRepository } from './lightscaper-native-photo-import-presets-current-v1.ts';
import { LightscaperNativePhotoSessionCallsCurrentV1 as Calls } from './lightscaper-native-photo-session-calls-current-v1.ts';
import { createLightscaperNativePhotoSessionFacadesCurrentV1 as facades, type LightscaperNativePhotoSessionComponentsCurrentV1 as Components } from './lightscaper-native-photo-session-facades-current-v1.ts';

export interface LightscaperNativePhotoSessionLeaseCurrentV1 {
	readonly catalogId: string;
	readonly selectionToken: string;
	readonly signal: AbortSignal;
	readonly components: Readonly<Components>;
	readonly importPresets: PresetRepository;
	readImportPresetEntryCurrentV1(): Promise<KeyValueEntry>;
	readonly exclusive: PhotoCatalogImportExclusiveV1;
	stop(): void;
	close(): Promise<void>;
}

/** Main-private prerequisite for the complete renderer Session composition.
 * localClose is the captured real inner Session close. Its closeResources must
 * retire only local consumers; the public outer close delegates to this lease.
 * This owner activates no renderer transport or backend selection by itself. */
export async function createLightscaperNativePhotoSessionLeaseCurrentV1(value: unknown,
	localClose: () => Promise<void>): Promise<Readonly<LightscaperNativePhotoSessionLeaseCurrentV1>> {
	const binding = consume(value), physicalClose = binding.components.close, quiesce = binding.components.media.quiesceEscapedWritersCurrentV1;
	let stopped = false, closing: Promise<void> | undefined, quiescing: Promise<void> | undefined;
	const assertCurrent = (): void => {
		check(binding.signal); if (stopped) throw new Error('Native selected Session has stopped.'); binding.assertCurrent(); check(binding.signal);
	};
	const exclusive = Exclusive.create(value), presets = Presets.create(binding.anchor, binding.catalogId, Object.freeze({ signal: binding.signal, assertCurrent }));
	const calls = new Calls(assertCurrent);
	const stop = (): void => {
		if (stopped) return; stopped = true;
		// Fence every front door before native abort listeners can reenter.
		exclusive.stop(); binding.stop();
		// Idle escaped upload writers can own the native stream ahead of an
		// accepted local operation. Cancel producers before joining consumers;
		// this does not release Original tickets, reader pins or SQLite owners.
		try { quiescing = Reflect.apply(quiesce, binding.components.media, []); }
		catch (error) { quiescing = Promise.reject(error); }
		void quiescing.catch(() => undefined);
	};
	const close = (): Promise<void> => {
		if (closing) return closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const failures: unknown[] = [];
		try { stop(); } catch (error) { failures.push(error); }
		const retire = async (): Promise<void> => {
			const local = await Promise.allSettled([Promise.resolve().then(localClose), exclusive.close(), presets.close(), quiescing]);
			failures.push(...local.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []));
			// Local consumer retirement precedes escaped native iterator/writer
			// cancellation, actual calls, physical tickets and the SQLite owners.
			if (!failures.length) { try { await calls.close(); } catch (error) { failures.push(error); } }
			if (failures.length) throw new AggregateError(failures, 'Native Session local retirement is unproved; physical owners retained.');
			await Reflect.apply(physicalClose, binding.components, []); binding.release();
		};
		void retire().then(resolve, (error: unknown) => { binding.quarantine(); reject(error); }); return closing;
	};
	try {
		const components = facades(binding.components, calls, close); assertCurrent();
		return Object.freeze({ catalogId: binding.catalogId, selectionToken: binding.selectionToken, signal: binding.signal,
			components, importPresets: presets.settingsRepository, readImportPresetEntryCurrentV1: () => presets.readEntryCurrentV1(), exclusive: exclusive.exclusive, stop, close });
	} catch (primary) {
		try { await close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Session construction and retirement failed.', { cause: cleanup }); }
		throw primary;
	}
}
