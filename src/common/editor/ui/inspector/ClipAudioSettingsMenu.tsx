/* SPDX-License-Identifier: AGPL-3.0-only */
import { useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { linearToDb } from './inspector-helpers.ts';

interface Clip {
	readonly id: string;
	readonly gain?: number;
	readonly linkPitchAndTempo?: boolean;
}
interface Controller {
	readonly actions: { readonly clip: {
		update(id: string, changes: Readonly<Record<string, unknown>>): unknown;
		setTimePitch(id: string, changes: Readonly<Record<string, unknown>>): unknown;
	} };
}
interface Props {
	readonly controller: object;
	readonly clip: Clip;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly effectsEnabled: boolean;
	readonly run: (operation: () => unknown) => unknown;
}

/** Unique audio operations remain available without repeating the inspector fields. */
export default function ClipAudioSettingsMenu({ controller, clip, copy, disabled, effectsEnabled, run }: Props) {
	const actions = (controller as Controller).actions.clip;
	const trigger = useRef<HTMLButtonElement>(null);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const [dialog, setDialog] = useState<'gain' | null>(null);
	const [gain, setGain] = useState(() => String(Number(linearToDb(clip.gain ?? 1).toFixed(2))));
	const [valueEdited, setValueEdited] = useState(false);
	const close = () => { setPosition(null); trigger.current?.focus({ preventScroll: true }); };
	const effectBlocked = disabled || !effectsEnabled;
	const item = (label: string, action: () => unknown, checked?: boolean, blocked = effectBlocked) => <ContextMenuItem
		key={label} label={label} role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} checked={checked} disabled={blocked} onClose={close} onClick={() => { run(action); }} />;
	const gainNumber = Number(gain);
	const valueLabel = `${copy.clipGain} (dB)`;
	const maximum = 20 * Math.log10(16);
	const gainValid = !valueEdited || (gain.trim() !== '' && Number.isFinite(gainNumber) && gainNumber >= -60 && gainNumber <= maximum);
	const applyGain = () => {
		if (disabled || !gainValid) return;
		if (valueEdited) run(() => actions.update(clip.id, { gain: Math.min(16, 10 ** (gainNumber / 20)) }));
		setDialog(null);
	};
	return <div className="audio-editor-panel-actions">
		<Button ref={trigger} variant="secondary" data-clip-audio-settings aria-haspopup="menu" aria-expanded={Boolean(position)}
			onClick={event => { if (!event) return; const bounds = event.currentTarget.getBoundingClientRect(); setPosition({ x: bounds.left, y: bounds.bottom }); }}>
			{copy.clipMediaSettings}
		</Button>
		<ContextMenu isOpen={Boolean(position)} x={position?.x ?? 0} y={position?.y ?? 0} autoFocus onClose={close} ariaLabel={copy.clipMediaSettings}>
			<ContextMenuItem label={`${copy.clipGain} (dB)`} disabled={disabled} onClick={() => { setGain(String(Number(linearToDb(clip.gain ?? 1).toFixed(2)))); setValueEdited(false); setDialog('gain'); }} onClose={close} />
			{item(copy.clipLinkPitchAndTempo, () => actions.setTimePitch(clip.id, { linkPitchAndTempo: !clip.linkPitchAndTempo }), Boolean(clip.linkPitchAndTempo))}
		</ContextMenu>
		{dialog && <AudioEditorDialogShell title={valueLabel} onClose={() => setDialog(null)} width={320}
			footer={<DialogFooter primaryText={copy.channelMappingApply} secondaryText={copy.cancel} primaryDisabled={!gainValid || disabled}
				onPrimaryClick={applyGain} onSecondaryClick={() => setDialog(null)} />}>
			<form onSubmit={event => { event.preventDefault(); applyGain(); }} onKeyDownCapture={event => {
				if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
				event.preventDefault(); event.stopPropagation(); applyGain();
			}}><label className="kw-audio-editor-dialog__field" data-clip-field={dialog}><span>{valueLabel}</span>
				<NumberStepper value={gain} onChange={value => { setValueEdited(true); setGain(value); }} ariaLabel={valueLabel} min={-60} max={maximum} step={1} disabled={disabled} />
			</label></form>
		</AudioEditorDialogShell>}
	</div>;
}
