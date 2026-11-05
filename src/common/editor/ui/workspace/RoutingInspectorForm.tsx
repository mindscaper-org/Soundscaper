/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type FormHTMLAttributes } from 'react';

type SavedFormValues = Readonly<Record<string, string | number | boolean | readonly string[]>>;
interface RoutingInspectorFormProps extends FormHTMLAttributes<HTMLFormElement> {
	readonly owner: string;
	readonly savedValues: SavedFormValues;
	readonly continuousNumbers?: readonly string[];
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
