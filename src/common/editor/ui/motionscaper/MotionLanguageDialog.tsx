/* SPDX-License-Identifier: AGPL-3.0-only */
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { ROUTE_LOCALES } from '../../../i18n/locales.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

export default function MotionLanguageDialog({ locale, copy, onApply, onClose }: Readonly<{
	locale: string; copy: Readonly<Record<string, string>>; onApply: (locale: string) => Promise<void>; onClose: () => void;
}>) {
	const id = useId(), [selected, setSelected] = useState(locale);
	const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
	const submit = async (event: FormEvent) => {
		event.preventDefault(); if (pending) return;
		setPending(true); setFailed(false);
		try { if (selected !== locale) await onApply(selected); onClose(); }
		catch { setFailed(true); } finally { setPending(false); }
	};
	return <AudioEditorDialogShell title={copy.motionscaperLanguage} onClose={pending ? undefined : onClose} width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={pending} onClick={onClose}>{copy.motionscaperCancel}</Button>
			<Button variant="primary" disabled={pending} type="submit" form={id}>{copy.motionscaperApply}</Button>
		</>} />}>
		<p>{copy.motionscaperLanguageHint}</p>
		<form id={id} onSubmit={event => { void submit(event); }}><label htmlFor={`${id}-locale`}>{copy.motionscaperLanguage}</label>
			<select id={`${id}-locale`} value={selected} disabled={pending} onChange={event => setSelected(event.currentTarget.value)}>
				{ROUTE_LOCALES.map(option => <option key={option.locale} value={option.locale}>{option.nativeName}</option>)}
			</select></form>
		{failed && <p role="alert">{copy.motionscaperLanguageFailed}</p>}
	</AudioEditorDialogShell>;
}
