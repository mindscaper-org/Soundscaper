/* SPDX-License-Identifier: AGPL-3.0-only */
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { normalizeSavingPreferences, type SavingPreferences } from '../../saving-preferences.ts';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';

export default function SavingPreferencesPanel(d: Readonly<{
	controller: { actions: { preferences: { update(patch: { saving: Partial<SavingPreferences> }): unknown } } };
	preferences?: SavingPreferences;
	copy: Readonly<Record<string, unknown>>;
	desktop: boolean;
	run(operation: () => unknown): unknown;
}>) {
	const copy = d.copy as Readonly<Record<'savingSection' | 'autoSaving' | 'savingOn' | 'savingOff' | 'askBeforeClosing' | 'savingDescription' | 'savingBrowserDescription', string>>;
	const preferences = normalizeSavingPreferences(d.preferences, d.desktop);
	const options = [{ value: 'on', label: copy.savingOn }, { value: 'off', label: copy.savingOff }];
	const update = (key: keyof SavingPreferences, value: string) => d.run(() => d.controller.actions.preferences.update({ saving: { [key]: value === 'on' } }));
	return <PreferencePanel title={copy.savingSection}>
		<div className="kw-audio-editor-preferences__grid">
			<PreferenceDropdownField label={copy.autoSaving} value={preferences.autoSaving ? 'on' : 'off'}
				onChange={(value: string) => update('autoSaving', value)} options={options} />
			{d.desktop && <PreferenceDropdownField label={copy.askBeforeClosing} value={preferences.askBeforeClosing ? 'on' : 'off'}
				onChange={(value: string) => update('askBeforeClosing', value)} options={options} />}
		</div>
		<p className="kw-audio-editor-preferences__note">{copy.savingDescription}</p>
		{!d.desktop && <p className="kw-audio-editor-preferences__note">{copy.savingBrowserDescription}</p>}
	</PreferencePanel>;
}
