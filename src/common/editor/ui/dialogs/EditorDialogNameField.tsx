/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';
import { TextInput } from '@soundscaper/design-system/TextInput';

/** Keep an existing multiline native name intact through the Rename form. */
export default function EditorDialogNameField({ value, onChange, onSubmit }: Readonly<{
	value: string;
	onChange(value: string): void;
	onSubmit(): void;
}>) {
	const multiline = useRef(value.includes('\n')).current;
	return <span onKeyDown={event => {
		if (!multiline || event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault(); event.stopPropagation(); onSubmit();
	}}><TextInput value={value} onChange={onChange} width="100%" multiline={multiline} /></span>;
}
