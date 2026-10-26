/* SPDX-License-Identifier: AGPL-3.0-only */
import { useRef } from 'react';
import { ToolbarButtonGroup } from '@soundscaper/design-system/Toolbar';
import { ToolButton } from '@soundscaper/design-system/ToolButton';
import { trackHeightCopy } from '../../../i18n/editor-track-height-copy.ts';
import { trackHeightViewportSpace } from '../timeline/track-height-menu.ts';

export const TRACK_HEIGHT_TOOLBAR_IDS = ['decrease-track-heights', 'increase-track-heights', 'fit-tracks-height'] as const;
export function trackHeightToolbarOptions(copy: Readonly<Record<string, string>>) {
	return [
		{ id: 'decrease-track-heights', label: copy.decreaseAllTrackHeights ?? 'Decrease all track heights', icon: 'track-decrease-height' },
		{ id: 'increase-track-heights', label: copy.increaseAllTrackHeights ?? 'Increase all track heights', icon: 'track-increase-height' },
		{ id: 'fit-tracks-height', label: trackHeightCopy(copy).fitTracksToHeight, icon: 'track-fit-height' },
	] as const;
}
interface Props {
	readonly buttons: Readonly<Record<string, boolean>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly controller: { readonly actions: {
		readonly track: { readonly decreaseAllHeights: () => unknown; readonly increaseAllHeights: () => unknown };
		readonly timeline: { readonly fitTracksToHeight: (ids?: readonly string[], available?: number) => unknown };
	} };
	readonly run: (operation: () => unknown) => unknown;
}

/** The optional trio reuses the native relative height steps and fits the measured viewport. */
export function TrackHeightToolbarControls({ buttons, copy, disabled, controller, run }: Props) {
	const root = useRef<HTMLDivElement>(null);
	const options = trackHeightToolbarOptions(copy).filter(option => buttons[option.id] === true);
	if (!options.length) return null;
	const actions = {
		'decrease-track-heights': controller.actions.track.decreaseAllHeights,
		'increase-track-heights': controller.actions.track.increaseAllHeights,
		'fit-tracks-height': () => controller.actions.timeline.fitTracksToHeight(undefined, trackHeightViewportSpace(root.current)),
	};
	return <div ref={root} className="kw-audio-editor__track-height-actions">
		<ToolbarButtonGroup gap={2}>
			{options.map(option => <ToolButton key={option.id} icon={option.icon} ariaLabel={option.label}
				disabled={disabled} onClick={() => run(actions[option.id])} />)}
		</ToolbarButtonGroup>
	</div>;
}
