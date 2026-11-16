/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import type { AudioEditorAdvancedPreferences } from '../../advanced-preferences.ts';
import { withEffectAutoIdleOverride } from '../../effect-auto-idle-preferences.ts';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';

export default function EffectAutoIdleOverrides({ preferences, copy, onChange }: {
	readonly preferences: AudioEditorAdvancedPreferences;
	readonly copy: Readonly<{ effectAutoIdleOverrides: string; effectAutoIdleInherit: string }>;
	readonly onChange: (overrides: AudioEditorAdvancedPreferences['effectAutoIdleOverrides']) => void;
}) {
	const entries = preferences.effectAutoIdleOverrides ?? [];
	if (!entries.length) return null;
	return <fieldset className="kw-audio-editor-preferences__auto-idle-overrides">
		<legend>{copy.effectAutoIdleOverrides}</legend>
		<ul>{entries.map(entry => <li key={entry.key}>
			<PreferenceCheckbox label={entry.name} checked={entry.enabled}
				onChange={enabled => onChange(withEffectAutoIdleOverride(preferences, entry.key, entry.name, enabled))} />
			<Button variant="secondary" aria-label={`${copy.effectAutoIdleInherit}: ${entry.name}`}
				onClick={() => onChange(withEffectAutoIdleOverride(preferences, entry.key, entry.name, null))}>
				{copy.effectAutoIdleInherit}
			</Button>
		</li>)}</ul>
	</fieldset>;
}
