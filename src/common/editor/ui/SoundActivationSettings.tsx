/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useRef, useState } from 'react';

import './audio-editor-design-system/20-sound-activation.css';

import type { SoundActivationPolicySnapshot } from '../controller/recording/sound-activation-policy-service.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../sound-activation-preferences.ts';
import {
	SOUND_ACTIVATION_UI_RANGES,
	createSoundActivationUiModel,
	type SoundActivationUiCopy,
} from './sound-activation-ui-model.ts';
import AudioEditorTimeCodeInput from './AudioEditorTimeCodeInput.tsx';
import EditorHelpTooltip from './EditorHelpTooltip.tsx';
import { useOperationFocusRecovery } from './useOperationFocusRecovery.ts';

interface SoundActivationActions {
	setThresholdDb(value: number): unknown;
	setHysteresisDb(value: number): unknown;
	setHoldMilliseconds(value: number): unknown;
	setAddTimestamps(value: boolean): unknown;
}

interface SoundActivationPreferencesCopy extends SoundActivationUiCopy {
	readonly helpMenu: string;
	readonly soundActivationSettings: string;
	readonly soundActivationThreshold: string;
	readonly soundActivationThresholdDescription: string;
	readonly soundActivationHysteresis: string;
	readonly soundActivationHysteresisDescription: string;
	readonly soundActivationHold: string;
	readonly soundActivationHoldDescription: string;
	readonly soundActivationAddTimestamps: string;
	readonly soundActivationAddTimestampsDescription: string;
}

interface SoundActivationSettingsProps {
	readonly productId: string;
	readonly locale: string;
	readonly readOnly: boolean;
	readonly soundActivation: SoundActivationPolicySnapshot;
	readonly copy: SoundActivationPreferencesCopy;
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly recording: Readonly<{ readonly soundActivation: SoundActivationActions }>;
		}>;
	}>;
	run(operation: () => unknown): unknown;
}

/** Settings for the dedicated sound-activated recording action. */
export default function SoundActivationSettings({
	productId,
	locale,
	readOnly,
	soundActivation,
	copy,
	controller,
	run,
}: SoundActivationSettingsProps) {
	const titleId = useId();
	const statusId = useId();
	const timestampDescriptionId = useId();
	const rememberFocus = useOperationFocusRecovery(soundActivation.preferenceMutationBlockReason === 'preference-update', controller);
	if (productId !== 'soundscaper') return null;
	const model = createSoundActivationUiModel(soundActivation, readOnly, locale, copy);
	const actions = controller.actions.recording.soundActivation;
	const decibels = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false });
	const decibelText = (value: number) => copy.soundActivationDecibelsValue.replace('{value}', decibels.format(value));
	const update = (operation: () => unknown) => {
		if (model.controlsDisabled) return false;
		rememberFocus();
		return run(operation);
	};
	return (
		<section
			className="kw-audio-editor-sound-activation"
			data-sound-activation-settings
			data-sound-activation-threshold-db={model.preferences.thresholdDb}
			data-sound-activation-hysteresis-db={model.preferences.hysteresisDb}
			data-sound-activation-hold-milliseconds={model.preferences.holdMilliseconds}
			data-sound-activation-add-timestamps={model.preferences.addTimestamps}
			data-sound-activation-pending={model.preferenceUpdatePending}
			data-sound-activation-block-reason={model.blockReason || undefined}
			aria-labelledby={titleId}
		>
			<h3 id={titleId}>{copy.soundActivationSettings}</h3>
			<fieldset
				className="kw-audio-editor-sound-activation__controls"
				aria-label={copy.soundActivationSettings}
				aria-disabled={model.controlsDisabled && model.blockReason !== 'preference-update'}
			>
				<SoundActivationRange
					helpLabel={copy.helpMenu}
					name="sound-activation-threshold"
					label={copy.soundActivationThreshold}
					description={copy.soundActivationThresholdDescription}
					value={model.preferences.thresholdDb}
					defaultValue={DEFAULT_SOUND_ACTIVATION_PREFERENCES.thresholdDb}
					valueText={model.thresholdValueText}
					formatValue={decibelText}
					range={SOUND_ACTIVATION_UI_RANGES.thresholdDb}
					disabled={model.controlsDisabled}
					preferencePending={model.blockReason === 'preference-update'} run={run}
					statusId={statusId}
					dataAttribute="threshold"
					onChange={(value) => actions.setThresholdDb(value)}
				/>
				<SoundActivationRange
					helpLabel={copy.helpMenu}
					name="sound-activation-hysteresis"
					label={copy.soundActivationHysteresis}
					description={copy.soundActivationHysteresisDescription}
					value={model.preferences.hysteresisDb}
					defaultValue={DEFAULT_SOUND_ACTIVATION_PREFERENCES.hysteresisDb}
					valueText={model.hysteresisValueText}
					formatValue={decibelText}
					range={SOUND_ACTIVATION_UI_RANGES.hysteresisDb}
					disabled={model.controlsDisabled}
					preferencePending={model.blockReason === 'preference-update'} run={run}
					statusId={statusId}
					dataAttribute="hysteresis"
					onChange={(value) => actions.setHysteresisDb(value)}
				/>
				<SoundActivationTime
					helpLabel={copy.helpMenu}
					name="sound-activation-hold"
					label={copy.soundActivationHold}
					description={copy.soundActivationHoldDescription}
					value={model.preferences.holdMilliseconds}
					valueText={model.holdValueText}
					range={SOUND_ACTIVATION_UI_RANGES.holdMilliseconds}
					disabled={model.controlsDisabled}
					statusId={statusId}
					onChange={(value) => update(() => actions.setHoldMilliseconds(value))}
				/>
				<label className="kw-audio-editor-sound-activation__switch">
					<input type="checkbox" name="sound-activation-add-timestamps"
						checked={model.preferences.addTimestamps}
						disabled={model.controlsDisabled}
						aria-label={copy.soundActivationAddTimestamps}
						aria-describedby={`${timestampDescriptionId} ${statusId}`}
						onChange={(event) => update(() => actions.setAddTimestamps(event.currentTarget.checked))} />
					<span>{copy.soundActivationAddTimestamps}</span>
					<EditorHelpTooltip subject={copy.soundActivationAddTimestamps}
						description={copy.soundActivationAddTimestampsDescription}
						helpLabel={copy.helpMenu} hook="sound-activation-add-timestamps"
						describedBy={timestampDescriptionId} />
					<span id={timestampDescriptionId} className="kw-audio-editor-sr-only">
						{copy.soundActivationAddTimestampsDescription}
					</span>
				</label>
			</fieldset>
			<p
				id={statusId}
				className="kw-audio-editor-sound-activation__status"
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>{model.blockReason ? model.statusMessage : ''}</p>
		</section>
	);
}

interface SoundActivationRangeProps {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly helpLabel: string;
	readonly value: number;
	readonly defaultValue?: number;
	readonly valueText: string;
	readonly formatValue?: (value: number) => string;
	readonly range: Readonly<{ minimum: number; maximum: number; step: number }>;
	readonly disabled: boolean;
	readonly preferencePending?: boolean;
	readonly run?: (operation: () => unknown) => unknown;
	readonly statusId: string;
	readonly dataAttribute: 'threshold' | 'hysteresis' | 'hold';
	onChange(value: number): unknown;
}

/** Keep an admitted range operable while its own writes drain, as native plug-in parameters do. */
function useSoundActivationRangeWrites(value: number, disabled: boolean, preferencePending: boolean,
	commit: (value: number) => unknown, run: (operation: () => unknown) => unknown) {
	const [draft, setDraft] = useState<number | null>(null);
	const session = useRef<{ next: number | null; operation: Promise<void> | null }>({ next: null, operation: null }).current;
	const unavailable = disabled && !(preferencePending && session.operation !== null);
	const current = useRef({ commit, unavailable });
	current.current = { commit, unavailable };
	const mounted = useRef(false);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	useEffect(() => {
		if (unavailable) { session.next = null; setDraft(null); }
	}, [session, unavailable]);
	const update = (next: number) => {
		if (unavailable) return;
		session.next = next;
		setDraft(next);
		if (session.operation) return;
		const operation = Promise.resolve().then(async () => {
			try {
				while (session.next !== null && !current.current.unavailable) {
					const admitted = session.next;
					session.next = null;
					await current.current.commit(admitted);
				}
			} finally {
				session.next = null;
				session.operation = null;
				if (mounted.current) setDraft(null);
			}
		});
		session.operation = operation;
		run(() => operation);
		void operation.catch(() => undefined);
	};
	return { value: draft ?? value, disabled: unavailable, update };
}

function SoundActivationRange({
	name,
	label,
	description,
	helpLabel,
	value,
	defaultValue,
	valueText,
	formatValue,
	range,
	disabled,
	preferencePending = false,
	run = operation => operation(),
	statusId,
	dataAttribute,
	onChange,
}: SoundActivationRangeProps) {
	const descriptionId = useId();
	const writes = useSoundActivationRangeWrites(value, disabled, preferencePending, onChange, run);
	const displayedText = formatValue?.(writes.value) ?? valueText;
	const data = { [`data-sound-activation-${dataAttribute}`]: true };
	return <label className="kw-audio-editor-sound-activation__control">
		<span>
			<span className="audio-editor-help-label">
				<strong>{label}</strong>
				<EditorHelpTooltip subject={label} description={description} helpLabel={helpLabel}
					hook={name} describedBy={descriptionId} />
			</span>
			<output htmlFor={name}>{displayedText}</output>
		</span>
		<input
			type="range"
			{...data}
			id={name}
			name={name}
			aria-label={label}
			aria-describedby={`${descriptionId} ${statusId}`}
			aria-valuetext={displayedText}
			min={range.minimum}
			max={range.maximum}
			step={range.step}
			value={writes.value}
			disabled={writes.disabled}
			onChange={(event) => writes.update(event.currentTarget.valueAsNumber)}
			onDoubleClick={(event) => {
				if (writes.disabled || defaultValue === undefined) return;
				event.preventDefault();
				event.stopPropagation();
				writes.update(defaultValue);
			}}
		/>
		<span id={descriptionId} className="kw-audio-editor-sr-only">{description}</span>
	</label>;
}

function SoundActivationTime({
	name, label, description, helpLabel, value, valueText, range, disabled, statusId, onChange,
}: Omit<SoundActivationRangeProps, 'dataAttribute'>) {
	const descriptionId = useId();
	return <label className="kw-audio-editor-sound-activation__control">
		<span>
			<span className="audio-editor-help-label">
				<strong>{label}</strong>
				<EditorHelpTooltip subject={label} description={description} helpLabel={helpLabel}
					hook={name} describedBy={descriptionId} />
			</span>
			<output htmlFor={name}>{valueText}</output>
		</span>
		<span data-sound-activation-hold>
			<AudioEditorTimeCodeInput name={name} label={label} value={value}
				unit="milliseconds" quantum={1} minimum={range.minimum} maximum={range.maximum}
				valueText={valueText} describedBy={`${descriptionId} ${statusId}`}
				disabled={disabled} onCommit={onChange} />
		</span>
		<span id={descriptionId} className="kw-audio-editor-sr-only">{description}</span>
	</label>;
}
