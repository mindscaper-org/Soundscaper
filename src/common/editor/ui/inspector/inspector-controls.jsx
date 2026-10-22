import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '@soundscaper/design-system/Dropdown';
import { TextInput } from '@soundscaper/design-system/TextInput';
import { BoundedTextInput } from './BoundedTextInput.tsx';

import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { cancelDraftEditOnEscape, createDraftBlurCommitGuard, draftBlurShouldCommit } from '../draft-blur-commit.ts';

export function CommitField({ label, name, value, type = 'text', min = undefined, max = undefined, step = undefined, disabled, readOnly, multiline, hookName = 'clip-field', visuallyHiddenLabel = false, preserveEditedDraft = false, onCommit }) {
	const [draft, setDraft] = useState(String(value ?? ''));
	const [error, setError] = useState(false);
	const editRevision = useRef(0);
	const editedDraft = useRef(false);
	const draftName = useRef(name);
	const blurCommitGuard = useRef(createDraftBlurCommitGuard()).current;
	useEffect(() => {
		editRevision.current++;
		if (preserveEditedDraft && draftName.current === name && editedDraft.current) return;
		draftName.current = name;
		editedDraft.current = false;
		setDraft(String(value ?? ''));
		setError(false);
	}, [name, value, preserveEditedDraft]);
	const commit = () => {
		if (disabled || readOnly || !draftBlurShouldCommit(blurCommitGuard)) return;
		editedDraft.current = false;
		const revision = editRevision.current;
		const resolve = (accepted) => {
			if (editRevision.current === revision) setError(accepted === false);
		};
		try {
			const outcome = onCommit(name, draft);
			if (outcome && typeof outcome.then === 'function') {
				void Promise.resolve(outcome).then(resolve, () => resolve(false));
			} else resolve(outcome);
		} catch {
			resolve(false);
		}
	};
	const hook = { [`data-${hookName}`]: name };
	const Input = type === 'number' ? BoundedTextInput : TextInput;
	return (
		<label className="audio-editor-field" {...hook} onKeyDown={(event) => {
			if (disabled || readOnly || event.nativeEvent?.isComposing) return;
			if (event.key === 'Enter' && !multiline) {
				event.preventDefault();
				event.stopPropagation();
				event.target.blur();
			} else if (event.key === 'Escape') {
				cancelDraftEditOnEscape(blurCommitGuard, { currentTarget: event.target,
					preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() }, () => {
					editRevision.current++;
					editedDraft.current = false;
					setDraft(String(value ?? ''));
					setError(false);
				});
			}
		}}>
			<span className={visuallyHiddenLabel ? 'kw-audio-editor-sr-only' : undefined}>{label}</span>
			<Input
				min={min}
				max={max}
				step={step}
				value={draft}
				type={type}
				multiline={multiline}
				disabled={disabled || readOnly}
				error={error}
				onChange={(next) => { editRevision.current++; editedDraft.current = true; setDraft(next); setError(false); }}
				onBlur={commit}
				width="100%"
			/>
		</label>
	);
}

export function LabeledDropdown({ label, options, value, onChange, disabled, hook }) {
	const wrapperRef = useRef(null);
	const availableOptions = options.filter((option) => !option.disabled);
	const dataHook = dropdownDataHook(hook);
	const handleChange = (next) => {
		if (!availableOptions.some((option) => option.value === next)) return;
		onChange(next);
	};
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="audio-editor-field" role="group" aria-label={label} {...dataHook}>
			<span>{label}</span>
			<Dropdown options={availableOptions} value={value} onChange={handleChange} disabled={disabled} width="100%" />
		</div>
	);
}

export function DesignCheckbox({ label, checked, disabled, onChange }) {
	return <PreferenceCheckbox label={label} checked={checked} disabled={disabled} onChange={onChange} />;
}

export function ActionHook({ hook, children }) {
	return <span data-clip-action={hook}>{children}</span>;
}

export { SteppedSlider } from './SteppedSlider.tsx';

function dropdownDataHook(hook) {
	if (['output', 'mode', 'range', 'format', 'bitDepth', 'quality', 'bitRateMode', 'vbrMode', 'sampleRate', 'channelMapping', 'dither', 'loudnessNormalization'].includes(hook)) {
		return { 'data-export-field': hook };
	}
	if (hook === 'clip-pitch-unit') return { 'data-clip-pitch-unit': '' };
	if (hook === 'effect-type') return { 'data-effect-type': '' };
	if (hook === 'audacity-effect-type') return { 'data-audacity-effect-type': '' };
	if (hook === 'video-effect-picker') return { 'data-video-effect-picker': '' };
	if (hook === 'audacity-control-track') return { 'data-audacity-control-track': '' };
	if (hook?.startsWith('effect-param-')) return { 'data-effect-param': hook.slice('effect-param-'.length) };
	if (hook === 'effect-context-controlTrackId') return { 'data-effect-context': 'controlTrackId' };
	return hook ? { 'data-effect-field': hook } : {};
}
