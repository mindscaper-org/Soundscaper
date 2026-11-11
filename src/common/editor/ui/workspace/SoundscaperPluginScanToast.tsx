/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState, useSyncExternalStore } from 'react';
import EditorToast from '../EditorToast.tsx';
import { resolveSoundscaperNativeServicesBridge, type SoundscaperNativeServicesBridge } from '../soundscaper-native-services-bridge.ts';
import { resolveSoundscaperNativeServicesCopy } from '../soundscaper-native-services-copy.ts';
import { soundscaperPluginScanRuntimeFor } from '../soundscaper-plugin-scan-runtime.ts';
import { openSoundscaperPluginManager } from './SoundscaperNativeServicesSurface.tsx';

interface Props {
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly controller: object;
	readonly openSurface: (surface: string, options: Readonly<{ section: string }>) => void;
}

export default function SoundscaperPluginScanToast(props: Props) {
	const bridge = resolveSoundscaperNativeServicesBridge();
	return bridge === null ? null : <PluginScanToast {...props} bridge={bridge} />;
}

function PluginScanToast({ bridge, copy: hostCopy, controller, openSurface }: Props & { readonly bridge: SoundscaperNativeServicesBridge }) {
	const copy = resolveSoundscaperNativeServicesCopy(hostCopy);
	const scanner = soundscaperPluginScanRuntimeFor(bridge);
	const scan = useSyncExternalStore(scanner.subscribe, scanner.getSnapshot, scanner.getSnapshot);
	const [dismissedGeneration, setDismissedGeneration] = useState<number | null>(null);
	useEffect(() => { void scanner.startOnOpen(); }, [scanner]);
	if (scan.status === 'idle' || dismissedGeneration === scan.generation) return null;
	const running = scan.status === 'running';
	const title = running ? copy.pluginScanToastRunning
		: scan.status === 'cancelled' ? copy.pluginScanToastCancelled
			: scan.status === 'failed' ? copy.pluginScanToastFailed : copy.pluginScanToastComplete;
	const progress = copy.pluginScanToastProgress.replace('{completed}', String(scan.completed)).replace('{total}', String(scan.total));
	return <EditorToast id={`native-plugin-scan-${scan.generation}`} key={scan.generation} title={title}
		type={scan.status === 'failed' ? 'warning' : running || scan.status === 'cancelled' ? 'info' : 'success'}
		description={running ? `${scan.currentFolder} · ${progress}` : scan.detail || `${copy.scanEntries}: ${scan.found}`}
		progress={running ? Math.round(scan.progress * 100) : undefined} persistent={running}
		actions={[running ? { label: copy.pluginScanToastPreferences, href: '#preferences/effects',
			onClick: () => openSurface('preferences', { section: 'effects' }) }
			: { label: copy.pluginScanToastManager, href: '#native-effect-manage',
				onClick: () => openSoundscaperPluginManager(controller) }]}
		dismissLabel={hostCopy.close} onDismiss={() => setDismissedGeneration(scan.generation)} />;
}
