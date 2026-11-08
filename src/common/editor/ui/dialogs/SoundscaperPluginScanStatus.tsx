/* SPDX-License-Identifier: AGPL-3.0-only */
import type { NativePluginScanSnapshot } from '../../controller/effects/native-plugin-scan-controller.ts';
import type { NativePluginAvailability } from '../soundscaper-native-services-bridge.ts';
import type { SoundscaperNativeServicesCopy } from '../soundscaper-native-services-copy.ts';

export function canScanPluginFolders(plugins: NativePluginAvailability | null): boolean {
	return plugins?.enabled === true && !plugins.quarantined && plugins.payload.status === 'available'
		&& plugins.consent.formats.some((format) => format.supported && format.granted && format.roots.some((root) => root.admitted));
}

export default function SoundscaperPluginScanStatus({ scan, plugins, copy }: Readonly<{
	scan: NativePluginScanSnapshot; plugins: NativePluginAvailability | null; copy: SoundscaperNativeServicesCopy;
}>) {
	const unavailable = plugins?.quarantined ? copy.pluginHelperQuarantined
		: plugins && plugins.payload.status !== 'available' ? copy.pluginRuntimeUnavailable
			: plugins && !plugins.enabled ? copy.pluginScanningOff : '';
	if (scan.status === 'idle' && !unavailable) return null;
	return <div className="kw-plugin-scan-status" role={scan.status === 'failed' ? 'alert' : 'status'}>
		{scan.status !== 'idle' && <p>{scan.status === 'running'
			? `${copy.scanRunning}: ${scan.currentFolder} · ${copy.pluginScanToastProgress.replace('{completed}', String(scan.completed)).replace('{total}', String(scan.total))}`
			: scan.status === 'failed' ? copy.pluginScanToastFailed
				: scan.status === 'cancelled' ? copy.pluginScanToastCancelled : copy.pluginScanToastComplete}</p>}
		{scan.detail && <p className="kw-plugin-scan-status__detail">{scan.detail}</p>}
		{unavailable && <p>{unavailable}</p>}
		{scan.status === 'failed' && <p>{copy.pluginScanRecoveryHelp}</p>}
	</div>;
}
