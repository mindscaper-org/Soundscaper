/* SPDX-License-Identifier: AGPL-3.0-only */
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { ProcessingButton as Button } from './ProcessingButton.tsx';
import type { SoundscaperNativeServicesCopy } from '../soundscaper-native-services-copy.ts';
import type { NativePluginConsentView } from '../soundscaper-native-services-bridge.ts';
import type { SoundscaperNativeServicesDialogAction } from '../soundscaper-native-services-dialog-model.ts';

export default function SoundscaperWinePreferences({ wine, copy, disabled, perform }: {
	readonly wine: NativePluginConsentView['linuxWineVst3'];
	readonly copy: SoundscaperNativeServicesCopy;
	readonly disabled: boolean;
	readonly perform: (action: SoundscaperNativeServicesDialogAction) => void;
}) {
	if (!wine?.supported) return null;
	const status = wine.state === 'ready' ? `${wine.version ?? ''} — ${wine.location ?? ''}`
		: wine.state === 'unavailable' ? copy.wineMissing
			: wine.state === 'unsupported' ? copy.wineUnsupported : copy.wineError;
	return <fieldset>
		<legend>{copy.wineTitle}</legend>
		<PreferenceCheckbox label={copy.wineVst3} checked={wine.enabled} disabled={disabled}
			onChange={(checked) => perform({ type: 'consent', format: 'vst3',
				consent: checked ? 'enable-wine-vst3' : 'disable-wine-vst3' })} />
		<p>{copy.wineHelp}</p>
		<p role="status" aria-label={copy.wineLocation}>{status}</p>
		{!wine.bridgeAvailable && <p>{copy.wineBridgeUnavailable}</p>}
		<Button disabled={disabled} onClick={() => perform({ type: 'consent', format: 'vst3', consent: 'browse-wine' })}>
			{copy.wineBrowse}</Button>
		<Button disabled={disabled} onClick={() => perform({ type: 'consent', format: 'vst3', consent: 'rescan-wine' })}>
			{copy.wineRescan}</Button>
		<Button disabled={disabled} onClick={() => perform({ type: 'consent', format: 'vst3', consent: 'clear-wine' })}>
			{copy.wineClear}</Button>
	</fieldset>;
}
