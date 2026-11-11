/* SPDX-License-Identifier: AGPL-3.0-only */

export interface NativePluginInstallationView {
	readonly installationId: string;
	readonly version: string;
	readonly allowed: boolean;
	readonly selected: boolean;
	readonly quarantined: boolean;
}

export interface NativePluginEntryView {
	readonly entryId: string;
	readonly kind?: 'effect' | 'analyzer';
	readonly classification?: string;
	readonly format: string;
	readonly name: string;
	readonly vendor: string;
	readonly eligible: boolean;
	readonly ineligibleReason: string | null;
	readonly installations: readonly NativePluginInstallationView[];
}

export interface NativePluginRegistryView {
	readonly entries: readonly NativePluginEntryView[];
}

export interface NativePluginInstanceProjectionV1 {
	readonly classification?: string;
	readonly instanceId: string;
	readonly entryId: string;
	readonly stablePluginId: string;
	readonly format: string;
	readonly binarySha256: string;
	readonly inputChannels: number;
	readonly outputChannels: number;
	readonly state: string;
	readonly enabled: boolean;
	readonly bypassed: boolean;
	readonly latencySamples: number;
}

export interface NativePluginStateBodyV1 {
	readonly kind: 'native-plugin-state';
	readonly bodyId: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface NativePluginOfflineOutcomeV1 {
	readonly instance: NativePluginInstanceProjectionV1;
	readonly blocksRendered: number;
	readonly renderedSha256: string;
}

export interface NativePluginVendorWindowV1 {
	readonly windowHandleId: string;
	readonly instanceId: string;
	readonly surface: 'helper-owned-top-level';
}

export type NativePluginVendorUiOutcomeV1 =
	| Readonly<{ status: 'opened'; window: NativePluginVendorWindowV1 }>
	| Readonly<{ status: 'refused'; code: string; message: string }>;

export interface NativePluginProjectStateV1 {
	readonly instanceId: string;
	readonly format: string;
	readonly stablePluginId: string;
	readonly binarySha256: string;
	readonly stateBody: NativePluginStateBodyV1;
	readonly enabled: boolean;
	readonly bypassed: boolean;
	readonly continuity: 'live' | 'bypass' | 'frozen';
	readonly latencySamples: number;
}

export interface SoundscaperNativePluginHostBridgeV1 {
	setNativePluginInstallationAllowed(request: Readonly<{
		installationId: string; allowed: boolean;
	}>): Promise<NativePluginRegistryView>;
	selectNativePluginInstallation(request: Readonly<{
		installationId: string;
	}>): Promise<NativePluginRegistryView>;
	instantiateNativePlugin(request: Readonly<{
		installationId: string; instanceId: string | null; sampleRate?: number;
	}>): Promise<NativePluginInstanceProjectionV1>;
	runNativePluginOffline(request: Readonly<{
		instanceId: string;
	}>): Promise<NativePluginOfflineOutcomeV1>;
	setNativePluginBypassed(request: Readonly<{
		instanceId: string; bypassed: boolean;
	}>): Promise<NativePluginInstanceProjectionV1>;
	persistNativePluginState(request: Readonly<{
		instanceId: string; generation: number;
	}>): Promise<Readonly<{
		outcome: Readonly<{ status: string }>;
		projectState: NativePluginProjectStateV1 | null;
	}>>;
	restoreNativePluginState(request: Readonly<{
		instanceId: string; generation: number; stateBody: NativePluginStateBodyV1;
	}>): Promise<Readonly<{ projectState: NativePluginProjectStateV1 }>>;
	openNativePluginVendorUi(request: Readonly<{ instanceId: string }>): Promise<NativePluginVendorUiOutcomeV1>;
	closeNativePluginVendorUi(request: Readonly<{
		instanceId: string; windowHandleId: string;
	}>): Promise<boolean>;
	closeNativePluginInstance(request: Readonly<{ instanceId: string }>): Promise<boolean>;
}
