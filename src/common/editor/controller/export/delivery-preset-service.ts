/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryPreset,
	type DeliveryPresetKind,
} from '../../delivery-preset.ts';
import { mutateDeliveryPresetCollection, type DeliveryPresetMutation, type DeliveryPresetMutationRepository } from './internal/delivery-preset-mutation.ts';
import { sanitizeSuggestedFileName } from '../../portable-save-file-name.ts';
import {
	type DeliveryPresetState,
	applyDeliveryPreset,
	createDeliveryPresetState,
	deleteDeliveryPreset,
	exportDeliveryPreset,
	importDeliveryPresets,
	listDeliveryPresets,
	saveDeliveryPresetToState,
} from '../../delivery-preset-store.ts';

/**
 * Controller surface for delivery presets.
 *
 * Mirrors the effect-preset service: every mutation normalizes, writes the
 * session state, persists under its own setting key, and publishes. Following
 * that shape means the export dialog can reuse the effect-preset controls
 * without either side special-casing the other.
 */

export const DELIVERY_PRESETS_SETTING_KEY = 'audio-editor-delivery-presets-v1';

export interface DeliveryPresetServiceRuntime {
	readonly presetRepository?: DeliveryPresetMutationRepository;
	readonly state: { deliveryPresets?: unknown; deliveryPresetsReadOnly?: boolean; projectAdministrationPending?: boolean };
	readonly persistSetting: (
		key: string,
		value: unknown,
		options?: Readonly<Record<string, unknown>>,
	) => Promise<unknown> | unknown;
	readonly publishDocumentSnapshot?: () => void;
	readonly createId?: (prefix: string) => string;
	readonly fileService?: {
		saveFile?: (request: Readonly<Record<string, unknown>>) => unknown;
	} | null;
}

export function createDeliveryPresetService(runtime: DeliveryPresetServiceRuntime) {
	if (!runtime?.state) throw new TypeError('A delivery preset service requires controller state.');
	const idFactory = () => runtime.createId?.('delivery-preset') ?? `delivery-preset-${Math.random().toString(36).slice(2)}`;
	let mutationTail: Promise<void> = Promise.resolve();

	function enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
		if (runtime.state.projectAdministrationPending) {
			return Promise.reject(new DOMException('Local editor settings are being cleared.', 'InvalidStateError'));
		}
		const result = mutationTail.then(operation);
		mutationTail = result.then(() => undefined, () => undefined);
		return result;
	}

	function assertWritable(): void {
		if (runtime.state.deliveryPresetsReadOnly === true) {
			throw new RangeError('The delivery preset library is read-only because its saved data could not be loaded.');
		}
	}

	async function commit<Result>(mutate: (current: DeliveryPresetState) => DeliveryPresetMutation<Result>): Promise<Result> {
		assertWritable();
		let committed: DeliveryPresetMutation<Result> | undefined;
		if (runtime.presetRepository) {
			const repository = runtime.presetRepository;
			await runtime.persistSetting(DELIVERY_PRESETS_SETTING_KEY, null, { policy: 'required', write: async () => {
				committed = await mutateDeliveryPresetCollection(repository, DELIVERY_PRESETS_SETTING_KEY, mutate);
			} });
		} else {
			const next = mutate(createDeliveryPresetState(runtime.state.deliveryPresets));
			const state = createDeliveryPresetState(next.state);
			await runtime.persistSetting(DELIVERY_PRESETS_SETTING_KEY, state, { policy: 'required' });
			committed = { state, result: next.result };
		}
		if (!committed) throw new Error('Delivery preset persistence did not perform its write.');
		runtime.state.deliveryPresets = committed.state;
		runtime.publishDocumentSnapshot?.();
		return committed.result;
	}

	return Object.freeze({
		flush: (): Promise<void> => mutationTail,
		reset: (): void => {
			runtime.state.deliveryPresets = createDeliveryPresetState();
			runtime.state.deliveryPresetsReadOnly = false;
		},
		list: (kind: DeliveryPresetKind | null = null): readonly DeliveryPreset[] =>
			listDeliveryPresets(runtime.state.deliveryPresets, kind),
		apply: (presetId: string): DeliveryPreset =>
			applyDeliveryPreset(runtime.state.deliveryPresets, presetId),
		async save(options: {
			id?: string;
			label: string;
			kind: DeliveryPresetKind;
			format: string;
			settings?: Readonly<Record<string, unknown>>;
			licensingRowId?: string | null;
			fallbackPresetId?: string | null;
			now?: string;
		}): Promise<DeliveryPreset> {
			const snapshot = Object.freeze({
				id: options.id,
				label: options.label,
				kind: options.kind,
				format: options.format,
				settings: options.settings === undefined ? undefined : structuredClone(options.settings),
				licensingRowId: options.licensingRowId,
				fallbackPresetId: options.fallbackPresetId,
				now: options.now,
			});
			return await enqueueMutation(async () => {
				return await commit(current => {
					const next = saveDeliveryPresetToState(current, { ...snapshot, idFactory });
					return { state: next.state, result: next.preset };
				});
			});
		},
		async delete(presetId: string): Promise<true> {
			const id = presetId;
			return await enqueueMutation(async () => {
				assertWritable();
				return await commit(current => ({ state: deleteDeliveryPreset(current, id), result: true as const }));
			});
		},
		async import(input: unknown): Promise<readonly DeliveryPreset[]> {
			const capturedInput = typeof input === 'string' ? input : structuredClone(input);
			const snapshot = importDeliveryPresets(createDeliveryPresetState(), capturedInput);
			return await enqueueMutation(async () => {
				return await commit(current => {
					const state = importDeliveryPresets(current, snapshot, { idFactory });
					return { state, result: listDeliveryPresets(state) };
				});
			});
		},
		export: (presetId: string): string =>
			exportDeliveryPreset(runtime.state.deliveryPresets, presetId),
		/** Write one preset out through the reserved 'preset' purpose. */
		async saveToFile(presetId: string): Promise<string> {
			const preset = applyDeliveryPreset(runtime.state.deliveryPresets, presetId);
			const text = exportDeliveryPreset(runtime.state.deliveryPresets, presetId);
			await runtime.fileService?.saveFile?.({
				purpose: 'preset',
				suggestedName: sanitizeSuggestedFileName(`${preset.label.replaceAll(/[^\p{L}\p{M}\p{N}_-]+/gu, '-') || 'delivery-preset'}.json`),
				mimeType: 'application/json',
				text,
			});
			return text;
		},
	});
}
