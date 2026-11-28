/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FormEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';

export function TracktionEditForm({ children, onApply, onInput }: {
	readonly children: ReactNode;
	readonly onApply: (fields: FormData) => void;
	readonly onInput?: () => void;
}) {
	const embedded = typeof window !== 'undefined' && window.self !== window.top;

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		onApply(new FormData(event.currentTarget));
	}

	function click(event: MouseEvent<HTMLFormElement>): void {
		const form = event.currentTarget;
		const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[type="submit"]') : null;
		if (button?.form !== form || button.matches(':disabled')) return;
		// Sandbox form restrictions run before the browser dispatches submit.
		event.preventDefault();
		if (form.reportValidity()) onApply(new FormData(form));
	}

	function enter(event: KeyboardEvent<HTMLFormElement>): void {
		if (event.key !== 'Enter' || event.repeat || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return;
		const button = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)');
		if (!button) return;
		event.preventDefault();
		button.click();
	}

	return <form onSubmit={submit} onClick={embedded ? click : undefined} onKeyDown={embedded ? enter : undefined} onInput={onInput}>
		{children}
	</form>;
}
