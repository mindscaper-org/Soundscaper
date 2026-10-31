/* SPDX-License-Identifier: AGPL-3.0-only */
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { clipInteractionCopy } from '../../../i18n/editor-clip-interactions-copy.ts';
import { ClipFadePresetItems } from './ClipFadePresetItems.tsx';
import type { SelectedClipFadeChanges } from './selected-clip-fades.ts';

interface Props {
	readonly clip: ({ readonly id: string; readonly kind: string } & SelectedClipFadeChanges) | null;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly onChange: (id: string, changes: SelectedClipFadeChanges) => void;
}

/** Both clip-menu parents share the handles' curve presets, editing and removal. */
export function ClipFadeMenuEntries({ clip, copy, disabled, onClose, onChange }: Props) {
	const labels = clipInteractionCopy(copy);
	if (clip?.kind !== 'audio') return null;
	return <>{(['in', 'out'] as const).map(edge => {
		const field = edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames';
		const shapeField = edge === 'in' ? 'fadeInShape' : 'fadeOutShape';
		return <ContextMenuItem key={edge} label={edge === 'in' ? copy.fadeIn : copy.fadeOut} disabled={disabled} hasSubmenu onClose={onClose}>
			<ClipFadePresetItems edge={edge} hasFade={(clip[field] ?? 0) > 0} shape={clip[shapeField]} copy={copy}
				onSelect={shape => { onClose(); onChange(clip.id, { [shapeField]: shape }); }} />
			<ContextMenuItem label={edge === 'in' ? labels.editFadeIn : labels.editFadeOut} onClick={() => {
				onClose();
				const element = [...document.querySelectorAll<HTMLElement>('[data-clip-id]')].find(item => item.dataset.clipId === clip.id);
				element?.dispatchEvent(new CustomEvent('scape-edit-fades', { bubbles: true }));
			}} />
			<ContextMenuItem label={edge === 'in' ? labels.removeFadeIn : labels.removeFadeOut} disabled={!(clip[field]! > 0)}
				onClick={() => { onClose(); onChange(clip.id, { [field]: 0 }); }} />
		</ContextMenuItem>;
	})}</>;
}
