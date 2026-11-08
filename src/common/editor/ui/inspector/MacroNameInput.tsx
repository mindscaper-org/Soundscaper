/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';
import { TextInput } from '@soundscaper/design-system/TextInput';

/** Keep the native name editor stable until its owning macro/program changes. */
export function MacroNameInput({ value, onChange, onCommit, onFocus, onBlur }: Readonly<{
	value: string;
	onChange(value: string): void;
	onCommit(): void;
	onFocus?(): void;
	onBlur?(): void;
}>) {
	const multiline = useRef(/[\r\n]/u.test(value)).current;
	return <span data-macro-name-input style={{ display: 'contents' }} onKeyDown={event => {
		if (!multiline || event.key !== 'Enter' || event.nativeEvent.isComposing) return;
		event.stopPropagation();
		if (event.shiftKey) return;
		event.preventDefault();
		onCommit();
	}}><TextInput value={value} multiline={multiline} onChange={onChange} onFocus={onFocus} onBlur={onBlur} width="100%" /></span>;
}
