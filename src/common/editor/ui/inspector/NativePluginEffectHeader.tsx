/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { pluginEffectType } from '../../effect-plugin-identity.ts';
import { createNativePluginPresetAdapter, nativePluginPresetBridge } from '../../controller/effects/native-plugin-preset-runtime.ts';
import type { SoundscaperNativePluginHostBridgeV1 } from '../../native-plugin-host-contract.ts';
import { pendingNativePluginParameterWrites } from '../native-plugin-parameter-write-drain.ts';
import PluginEffectPresetHeader from './PluginEffectPresetHeader.tsx';

export default function NativePluginEffectHeader({ controller, bridge: suppliedBridge, identity, copy, name, enabled, disabled, onEnabledChange }: {
	readonly controller?: unknown;
	readonly bridge?: SoundscaperNativePluginHostBridgeV1;
	readonly identity: Readonly<{ instanceId: string; format: string; stablePluginId: string; binarySha256: string; classification?: string }>;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly name: string;
	readonly enabled: boolean;
	readonly disabled?: boolean;
	readonly onEnabledChange?: (enabled: boolean) => PromiseLike<unknown> | unknown;
}) {
	const bridge = suppliedBridge ?? nativePluginPresetBridge(controller);
	const { instanceId, format, stablePluginId, binarySha256 } = identity;
	const adapter = useMemo(() => bridge ? createNativePluginPresetAdapter(bridge,
		{ instanceId, format, stablePluginId, binarySha256 }, () => pendingNativePluginParameterWrites(instanceId)) : null,
	[bridge, instanceId, format, stablePluginId, binarySha256]);
	return <PluginEffectPresetHeader controller={controller} copy={copy} name={`${name} (${format.toUpperCase()})`}
		effectType={pluginEffectType(format, stablePluginId)} resetKey={instanceId}
		disabled={disabled || !adapter} realtime={identity.classification !== 'instrument'} enabled={enabled} onEnabledChange={onEnabledChange ?? (next => bridge?.setNativePluginBypassed({ instanceId, bypassed: !next }))}
		read={() => adapter?.read() ?? {}} apply={params => adapter?.apply(params)} />;
}
