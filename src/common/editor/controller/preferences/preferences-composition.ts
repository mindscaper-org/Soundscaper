/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyAudioEditorWorkspace, createAudioEditorPreferencesV1, createCustomAudioEditorWorkspace,
	deleteCustomAudioEditorWorkspace, findAudioEditorShortcutConflicts, loadAudioEditorPreferencesV1,
	normalizeAudioEditorShortcut, updateAudioEditorPreferencesV1, updateCustomAudioEditorWorkspace,
} from '../../preferences.js';
import { createStableId } from '../../project.js';
import { mergeManagedPreferencePreset } from '../../preference-merge.ts';
import { createEditorPreferenceActionOwner } from './preference-action-group.ts';
import type { AudioEditorOptimizationMode } from '../../performance-preferences.ts';
import { createEditorPreferenceActionDelegates, createEditorPreferencesService } from './internal/preferences-service.ts';
import { applyLoadedPreferenceSession } from './internal/preference-session-defaults.ts';
import { setEngineIdleEffectProcessing } from '../../engine/idle-effect-host.ts';
import type { EditorControllerLifetime } from '../shared/lifecycle.ts';
import type { createSettingPersistence } from './setting-persistence.ts';

type Preferences = ReturnType<typeof createAudioEditorPreferencesV1>;

export function createPreferencesComposition(d: {
	readonly productId: string;
	readonly defaultWorkspace: string;
	readonly defaultOptimizationMode?: AudioEditorOptimizationMode;
	readonly defaultWaveformRenderer?: 'gpu';
	readonly isDesktop?: boolean;
	readonly loadManagedPreferences?: () => Promise<unknown>;
	readonly engine?: object & { readonly context?: BaseAudioContext | null };
	readonly state: { preferences: Preferences; preferencesReadOnly: boolean; timelineView: string };
	readonly lifetime: EditorControllerLifetime;
	readonly copy: Readonly<{ preferencesNewerSchema: string; shortcutActionRequired: string; shortcutConflict: string }>;
	readonly loadSetting: (key: string, fallback: unknown) => Promise<unknown>;
	readonly persistSetting: (key: string, value: unknown,
		options?: Parameters<ReturnType<typeof createSettingPersistence>['persist']>[2]) => Promise<unknown>;
	readonly publish: () => void;
	readonly setPcmOptimizationMode?: (mode: AudioEditorOptimizationMode) => void;
}) {
	d.setPcmOptimizationMode?.(d.state.preferences.performance.optimizeFor);
	if (d.engine) setEngineIdleEffectProcessing(d.engine, d.state.preferences.advanced.suspendIdleEffectProcessing !== false, d.state.preferences.advanced.effectAutoIdleOverrides);
	const service = createEditorPreferencesService<Preferences>({
		productId: d.productId, preferenceSettingKey: `${d.productId}:audio-editor-preferences-v1`, defaultWorkspace: d.defaultWorkspace,
		get newerSchemaMessage() { return d.copy.preferencesNewerSchema; }, get shortcutActionRequired() { return d.copy.shortcutActionRequired; }, get shortcutConflict() { return d.copy.shortcutConflict; },
		getPreferences: () => d.state.preferences,
		setPreferences: (value) => {
			d.state.preferences = value;
			d.setPcmOptimizationMode?.(value.performance.optimizeFor);
			if (d.engine) setEngineIdleEffectProcessing(d.engine, value.advanced.suspendIdleEffectProcessing !== false, value.advanced.effectAutoIdleOverrides);
		},
		getReadOnly: () => d.state.preferencesReadOnly,
		setReadOnly: (value) => { d.state.preferencesReadOnly = value; },
		loadSetting: d.loadSetting, persistSetting: (key, value) => d.persistSetting(key, value),
		persistSettingRequired: (key, value) => d.persistSetting(key, value, { policy: 'required' }),
		publish: d.publish, loadPreferences: (saved) => {
			const loaded = loadAudioEditorPreferencesV1(saved);
			if (loaded.readOnly) return loaded;
			let preferences = loaded.preferences;
			if (d.isDesktop && (saved as { saving?: { autoSaving?: unknown } }).saving?.autoSaving === undefined) {
				preferences = updateAudioEditorPreferencesV1(preferences, { saving: { autoSaving: false } });
			}
			const savedMode = (saved as { readonly performance?: { readonly optimizeFor?: unknown } }).performance?.optimizeFor;
			if (d.defaultOptimizationMode === 'speed' && savedMode !== 'memory' && savedMode !== 'speed') {
				preferences = updateAudioEditorPreferencesV1(preferences, { performance: { optimizeFor: 'speed' } });
			}
			if (d.defaultWaveformRenderer === 'gpu' && preferences.waveformDisplay.renderer === undefined) {
				preferences = updateAudioEditorPreferencesV1(preferences, { waveformDisplay: { renderer: 'gpu' } });
			}
			return { ...loaded, preferences };
		},
		createPreferences: (activeId) => createAudioEditorPreferencesV1({ workspace: { activeId }, saving: { autoSaving: !d.isDesktop }, performance: { optimizeFor: d.defaultOptimizationMode ?? 'memory' }, waveformDisplay: { renderer: d.defaultWaveformRenderer } }),
		applyWorkspace: applyAudioEditorWorkspace, updatePreferences: (preferences, patch) => updateAudioEditorPreferencesV1(preferences, patch ?? {}),
		normalizeShortcut: normalizeAudioEditorShortcut, findShortcutConflicts: findAudioEditorShortcutConflicts,
		createWorkspace: createCustomAudioEditorWorkspace, updateWorkspace: (preferences, id, changes) => updateCustomAudioEditorWorkspace(preferences, id, changes ?? {}), deleteWorkspace: (preferences, id) => deleteCustomAudioEditorWorkspace(preferences, id, d.defaultWorkspace),
	});
	return Object.freeze({
		service,
		actions: createEditorPreferenceActionOwner(createEditorPreferenceActionDelegates(service, createStableId)),
		async load(token = d.lifetime.capture()): Promise<Preferences> {
			const preset = d.isDesktop ? await d.lifetime.guard(d.loadManagedPreferences?.() ?? null, token) : null;
			let loaded = await service.load(value => d.lifetime.guard(value, token));
			if (preset && typeof preset === 'object' && 'launchId' in preset && typeof preset.launchId === 'string'
				&& 'preferences' in preset && preset.preferences && typeof preset.preferences === 'object'
				&& Object.keys(preset.preferences).length && !d.state.preferencesReadOnly) {
				const key = `${d.productId}:managed-preference-launch`;
				if (await d.lifetime.guard(d.loadSetting(key, null), token) !== preset.launchId) {
					loaded = await d.lifetime.guard(service.update(mergeManagedPreferencePreset(
						loaded, preset.preferences as Readonly<Record<string, unknown>>,
					)), token);
					await d.lifetime.guard(d.persistSetting(key, preset.launchId, { policy: 'required' }), token);
				}
			}
			return applyLoadedPreferenceSession(loaded, d.state);
		},
	});
}
