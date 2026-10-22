/* SPDX-License-Identifier: AGPL-3.0-only */
import { Checkbox } from '@soundscaper/design-system/Checkbox';
import { CORRIDORKEY_CHROMA_HINT_DEFAULTS, type CorridorKeyHintSettings } from '../../assistance/corridorkey-hint-settings.ts';
import type { resolveCorridorKeyCopy } from '../../../i18n/editor-corridorkey-copy.ts';

interface Props {
	readonly settings: CorridorKeyHintSettings;
	readonly onChange: (settings: CorridorKeyHintSettings) => void;
	readonly disabled: boolean;
	readonly text: ReturnType<typeof resolveCorridorKeyCopy>;
}

/** Opt-in controls live only in the menu-owned keying dialog. */
export default function CorridorKeyHintControls({ settings, onChange, disabled, text }: Props) {
	const enabled = settings.hintMode === 'chroma-key';
	return <fieldset disabled={disabled}>
		<legend>{text.hintTitle}</legend>
		<label><Checkbox checked={enabled} disabled={disabled} aria-label={text.hintEnabled}
			onChange={(checked) => onChange(checked ? CORRIDORKEY_CHROMA_HINT_DEFAULTS : { settingsVersion: 1, hintMode: 'none' })} />
			{text.hintEnabled}</label>
		<p>{text.hintDescription}</p>
		{enabled && <>
			<label>{text.hintColor} <input type="color" value={`#${settings.keyColor.toString(16).padStart(6, '0')}`}
				onChange={(event) => onChange({ ...settings, keyColor: Number.parseInt(event.currentTarget.value.slice(1), 16) })} /></label>
			{(['similarity', 'softness', 'hintQuality'] as const).map((field) => <label key={field}>
				{text[field]} <input type="number" min={field === 'similarity' ? 0.01 : 0} max={1} step={0.01}
					value={settings[field]} onChange={(event) => {
						const value = event.currentTarget.valueAsNumber;
						if (Number.isFinite(value) && value >= (field === 'similarity' ? 0.01 : 0) && value <= 1)
							onChange({ ...settings, [field]: value });
					}} />
			</label>)}
		</>}
	</fieldset>;
}
