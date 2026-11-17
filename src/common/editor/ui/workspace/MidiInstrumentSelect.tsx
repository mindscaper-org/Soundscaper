/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useState } from 'react';
import { MIDI_INSTRUMENTS, type MidiInstrument } from '../../midi-model.ts';
import { midiNativeInstallationId } from '../../midi-native-installation-id.ts';
import { nativePluginPresetBridge } from '../../controller/effects/native-plugin-preset-runtime.ts';
import { resolveSoundscaperNativeServicesBridge } from '../soundscaper-native-services-bridge.ts';
import { midiNativeInstrumentChoices, type MidiNativeInstrumentChoice } from './midi-native-instrument-choices.ts';
import EditorControlLabel from '../EditorControlLabel.tsx';
import { openSoundscaperMidiInstrumentSettings } from './SoundscaperNativeServicesSurface.tsx';
import { subscribeNativePluginRegistryChanges } from '../native-plugin-registry-events.ts';

interface Props {
	readonly controller: object;
	readonly track: unknown;
	readonly instrument: MidiInstrument;
	readonly sampleRate: number;
	readonly disabled: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly setInstrument: (instrument: MidiInstrument) => unknown;
	readonly run: (operation: () => unknown) => unknown;
}

/** Instrument availability lives inside the existing MIDI selector, independently of effect menus. */
export function MidiInstrumentSelect({ controller, track, instrument, sampleRate, disabled, copy, setInstrument, run }: Props) {
	const [choices, setChoices] = useState<readonly MidiNativeInstrumentChoice[]>([]);
	const bridge = resolveSoundscaperNativeServicesBridge();
	const refresh = useCallback(async () => bridge ? midiNativeInstrumentChoices(await bridge.listNativePlugins(), track) : [], [bridge, track]);
	useEffect(() => {
		let current = true;
		let generation = 0;
		const update = () => {
			const requested = ++generation;
			void refresh().then(next => { if (current && requested === generation) setChoices(next); })
				.catch(() => { if (current && requested === generation) setChoices([]); });
		};
		const unsubscribe = subscribeNativePluginRegistryChanges(update);
		update();
		return () => { current = false; unsubscribe(); };
	}, [refresh]);
	const selected = typeof instrument === 'string' ? instrument : `native:${midiNativeInstallationId(instrument)}`;
	const assign = (value: string) => {
		if (value === 'native:settings') { openSoundscaperMidiInstrumentSettings(controller); return; }
		if (!value.startsWith('native:')) { setInstrument(value as MidiInstrument); return; }
		const installationId = value.slice('native:'.length);
		run(async () => {
			const native = nativePluginPresetBridge(controller);
			if (!native) throw new Error('The desktop MIDI instrument runtime is unavailable.');
			await native.selectNativePluginInstallation({ installationId });
			const instance = await native.instantiateNativePlugin({ installationId, instanceId: null, sampleRate });
			await native.closeNativePluginInstance({ instanceId: instance.instanceId });
		});
	};
	return <label><EditorControlLabel>{copy.instrument}</EditorControlLabel><select value={selected} disabled={disabled}
		onChange={event => assign(event.currentTarget.value)}>
		{typeof instrument !== 'string' && !choices.some(choice => `native:${choice.installationId}` === selected)
			&& <option value={selected}>{instrument.name}</option>}
		{MIDI_INSTRUMENTS.map(value => <option key={value} value={value}>{copy[value]}</option>)}
		{choices.map(choice => <option key={choice.installationId} value={`native:${choice.installationId}`}>{choice.label}</option>)}
		{bridge && <option value="native:settings">{copy.instrumentSettings}</option>}
	</select></label>;
}
