/* SPDX-License-Identifier: AGPL-3.0-only */
export const MANAGED_FEATURES = [
	'OnlineFeaturesAllowed', 'ApplicationUpdatesAllowed', 'ModelDownloadsAllowed',
	'FreesoundAllowed', 'AudiocomAllowed', 'WebVcrAllowed', 'ExternalLinksAllowed',
	'ExternalCodecInstallationAllowed', 'LocalIntegrationsAllowed',
] as const;
export type ManagedFeature = typeof MANAGED_FEATURES[number];
type Preferences = Readonly<Record<string, unknown>>;
export interface ManagedPolicyInput {
	readonly machine?: Preferences;
	readonly user?: Preferences;
	readonly msi?: boolean;
}
export interface ManagedPolicy {
	readonly desktopPreferences: Preferences;
	readonly editorPreferences: Preferences;
	readonly msi: boolean;
	allows(feature: ManagedFeature): boolean;
	assertAllowed(feature: ManagedFeature): void;
}
const DESKTOP_BOOLEAN_KEYS = new Set(['updatesEnabled', 'nativeProbeHelperEnabled', 'nativeAudioHelperEnabled',
	'nativePluginDiscoveryEnabled', 'nativeMediaEnabled', 'nativeHardwareDecodeEnabled', 'nativeHardwareEncodeEnabled', 'ofxConsentEnabled']);
const EDITOR_KEYS = new Set(['appearance', 'view', 'editing', 'workspace', 'shortcuts', 'spectrogram', 'waveformVisualization',
	'waveformDisplay', 'import', 'recording', 'playback', 'effects', 'performance', 'advanced', 'saving', 'temporaryData', 'startup']);

/** Windows resolves GPO scope; the application gives machine values precedence per setting. */
export function resolveManagedPolicy({ machine = {}, user = {}, msi = false }: ManagedPolicyInput = {}): ManagedPolicy {
	const features = new Map<ManagedFeature, boolean>();
	for (const feature of MANAGED_FEATURES) {
		for (const source of [user, machine]) {
			if (!Object.hasOwn(source, feature)) continue;
			if (source[feature] !== 0 && source[feature] !== 1) throw new TypeError(`${feature} policy must be a DWORD containing 0 or 1.`);
			features.set(feature, source[feature] === 1);
		}
	}
	const preset = merge(parsePreset(user.LaunchPreferences), parsePreset(machine.LaunchPreferences));
	function allows(feature: ManagedFeature): boolean {
		if (feature === 'ApplicationUpdatesAllowed' && msi) return false;
		return features.get(feature) !== false
			&& (feature === 'LocalIntegrationsAllowed' || features.get('OnlineFeaturesAllowed') !== false);
	}
	return Object.freeze({ msi, desktopPreferences: Object.freeze(record(preset.desktop ?? {})),
		editorPreferences: Object.freeze(record(preset.editor ?? {})), allows,
		assertAllowed(feature: ManagedFeature) {
			if (!allows(feature)) throw new Error(`This feature is disabled by administrator policy (${feature}).`);
		},
	});
}

function parsePreset(value: unknown): Record<string, unknown> {
	if (value === undefined) return {};
	if (typeof value !== 'string' || value.length > 65_536) throw new TypeError('Launch preference policy must be a bounded JSON string.');
	const parsed = record(JSON.parse(value));
	if (parsed.schemaVersion !== 1) throw new TypeError('Unsupported launch preference policy schema.');
	for (const key of Object.keys(parsed)) if (!['schemaVersion', 'desktop', 'editor'].includes(key)) throw new TypeError('Unknown launch preference section.');
	const desktop = record(parsed.desktop ?? {}), editor = record(parsed.editor ?? {});
	for (const [key, entry] of Object.entries(desktop)) {
		if (DESKTOP_BOOLEAN_KEYS.has(key) ? typeof entry !== 'boolean'
			: ['locale', 'modelsDirectory'].includes(key) ? entry !== null && typeof entry !== 'string' : true) {
			throw new TypeError(`Unsupported desktop preference policy: ${key}.`);
		}
	}
	for (const key of Object.keys(editor)) if (!EDITOR_KEYS.has(key)) throw new TypeError(`Unsupported editor preference policy: ${key}.`);
	assertSafePreferences(parsed, 0);
	return { desktop, editor };
}

function assertSafePreferences(value: unknown, depth: number): void {
	if (depth > 16) throw new TypeError('Launch preference policy is too deeply nested.');
	if (!value || typeof value !== 'object') return;
	for (const [key, child] of Object.entries(value)) {
		if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe preference policy key.');
		assertSafePreferences(child, depth + 1);
	}
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Launch preference policy must contain objects.');
	return value as Record<string, unknown>;
}

function merge(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
	const result = { ...left };
	for (const [key, value] of Object.entries(right)) {
		const previous = result[key];
		result[key] = value && previous && typeof value === 'object' && typeof previous === 'object'
			&& !Array.isArray(value) && !Array.isArray(previous) ? merge(record(previous), record(value)) : value;
	}
	return result;
}
