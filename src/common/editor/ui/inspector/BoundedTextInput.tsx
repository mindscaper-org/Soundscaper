/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useRef, type ComponentProps } from 'react';
import { TextInput } from '@soundscaper/design-system/TextInput';
import { useNativeNumberBounds } from './useNativeNumberBounds.ts';

interface Props extends ComponentProps<typeof TextInput> {
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
}

/** Retain vendor rendering while exposing native numeric constraints as typed props. */
export function BoundedTextInput({ min, max, step, ...props }: Props) {
	const container = useRef<HTMLSpanElement>(null);
	useNativeNumberBounds(container, props.type ?? 'text', min, max, step);
	return <span ref={container} style={{ display: 'contents' }}><TextInput {...props} /></span>;
}
