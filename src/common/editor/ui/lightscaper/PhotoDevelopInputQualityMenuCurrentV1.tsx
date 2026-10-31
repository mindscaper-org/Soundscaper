/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useRef } from 'react';
import { photoDevelopInputQualityCopy } from '../../../i18n/lightscaper-develop-input-quality-copy.ts';
import type { PhotoDevelopInputQualityCurrentV1 } from '../../photo-develop-input-quality-current-v1.ts';
export interface PhotoDevelopInputQualityMenuPropsCurrentV1 {
	readonly locale: string; readonly disabled: boolean; readonly isCurrent: () => boolean;
	readonly value: PhotoDevelopInputQualityCurrentV1; readonly onChange: (value: PhotoDevelopInputQualityCurrentV1) => void;
}
/** Opt-in presentation input, outside saved Develop and full-resolution exports. */
export default function PhotoDevelopInputQualityMenuCurrentV1(props: PhotoDevelopInputQualityMenuPropsCurrentV1) {
	const text = photoDevelopInputQualityCopy(props.locale), latest = useRef(props), live = useRef(false); latest.current = props;
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	return <details data-photo-develop-input-menu><summary>{text.menu}</summary>{(['original', 'preview-derivative'] as const).map(value =>
		<button key={value} type="button" disabled={props.disabled} aria-pressed={props.value === value} onClick={() => {
			if (live.current && latest.current === props && !props.disabled && props.isCurrent()) Reflect.apply(props.onChange, props, [value]);
		}}>{value === 'original' ? text.original : text.preview}</button>)}</details>;
}
