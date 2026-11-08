/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type FormHTMLAttributes } from 'react';

type SavedFormValues = Readonly<Record<string, string | number | boolean | readonly string[]>>;
interface RoutingInspectorFormProps extends FormHTMLAttributes<HTMLFormElement> {
	readonly owner: string;
	readonly savedValues: SavedFormValues;
	readonly continuousNumbers?: readonly string[];
}

/** Imported multiline names retain an editor that cannot sanitize their lines. */
export function RoutingNameInput({ value, disabled, readOnly = false }: Readonly<{
	value: string; disabled: boolean; readOnly?: boolean;
}>) {
	const multiline = useRef(/[\r\n]/u.test(value)).current;
	const props = { name: 'name', maxLength: 1024, defaultValue: value, disabled, readOnly };
	return multiline ? <textarea {...props} rows={2} onKeyDown={event => {
		if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
			|| event.ctrlKey || event.metaKey || event.altKey
			|| event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.form?.requestSubmit();
	}} /> : <input {...props} />;
}

/** Native textarea/FormData line-ending normalization is not an authored edit. */
export function routingFormName(data: FormData, saved: string): string {
	const value = String(data.get('name') ?? '');
	const normalized = (text: string) => text.replace(/\r\n?/gu, '\n');
	return normalized(value) === normalized(saved) ? saved : value;
}

/** Publish saved fields without replacing the form or overwriting unrelated drafts. */
export default function RoutingInspectorForm({ owner, savedValues, continuousNumbers = [], onSubmit, ...props }: RoutingInspectorFormProps) {
	const formRef = useRef<HTMLFormElement>(null);
	const previous = useRef<Readonly<{ owner: string; values: SavedFormValues }> | null>(null);
	const currentValues = useRef(savedValues);
	currentValues.current = savedValues;
	const signature = JSON.stringify(savedValues);
	useLayoutEffect(() => {
		const values = currentValues.current;
		const prior = previous.current;
		for (const control of formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
			'input, select, textarea',
		) ?? []) {
			const value = values[control.name];
			if (value === undefined || (prior?.owner === owner && JSON.stringify(prior.values[control.name]) === JSON.stringify(value))) continue;
			if (control.tagName === 'INPUT' && (control.type === 'checkbox' || control.type === 'radio')) {
				(control as HTMLInputElement).checked = typeof value === 'boolean' ? value
					: Array.isArray(value) && value.includes(control.value);
			} else control.value = String(value);
		}
		previous.current = { owner, values };
	}, [owner, signature]);
	return <form {...props} key={owner} ref={formRef} noValidate={continuousNumbers.length > 0 || props.noValidate}
		onSubmit={event => {
			if (continuousNumbers.length && !continuousFormValid(event.currentTarget, continuousNumbers)) {
				event.preventDefault(); return;
			}
			onSubmit?.(event);
		}} />;
}

/** Native arrow steps remain useful without restricting an authored continuous value. */
function continuousFormValid(form: HTMLFormElement, names: readonly string[]): boolean {
	const controls = Array.from(form.querySelectorAll<HTMLInputElement>('input'))
		.filter(input => input.type === 'number' && names.includes(input.name));
	const steps = controls.map(input => input.step);
	try {
		for (const input of controls) input.step = 'any';
		return form.reportValidity();
	} finally {
		controls.forEach((input, index) => {
			input.step = steps[index] ?? '';
		});
	}
}
