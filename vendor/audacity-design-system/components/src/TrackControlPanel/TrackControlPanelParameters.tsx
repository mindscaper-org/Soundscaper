import React from 'react';
import { PanKnob } from '../PanKnob';
import { Slider } from '../Slider';
import { ToggleButton } from '../ToggleButton';

interface MuteSoloProps {
	readonly copy: Readonly<{ mute: string; solo: string }>;
	readonly disabled: boolean;
	readonly tabIndex: number;
	readonly isMuted: boolean;
	readonly isSolo: boolean;
	readonly onMuteToggle?: (event: React.MouseEvent<HTMLButtonElement>) => void;
	readonly onSoloToggle?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

interface ParametersProps extends MuteSoloProps {
	readonly copy: MuteSoloProps['copy'] & Readonly<{ pan: string; volume: string }>;
	readonly volume: number;
	readonly defaultVolume: number;
	readonly pan: number;
	readonly panDisabled: boolean;
	readonly onVolumeChange?: (value: number) => void;
	readonly onPanChange?: (value: number) => void;
	readonly onVolumeGestureStart?: (value: number) => void;
	readonly onVolumeGestureEnd?: (value: number) => void;
	readonly onVolumeGestureCancel?: () => void;
	readonly onPanGestureStart?: (value: number) => void;
	readonly onPanGestureEnd?: (value: number) => void;
	readonly onPanGestureCancel?: () => void;
}

export function TrackControlPanelMuteSoloButtons({ copy, disabled, tabIndex, isMuted, isSolo,
	onMuteToggle, onSoloToggle }: MuteSoloProps) {
	return <div className="track-control-panel__button-group" onClick={event => event.stopPropagation()}>
		<ToggleButton active={isMuted} disabled={disabled} onClick={onMuteToggle} ariaLabel={copy.mute} tabIndex={tabIndex} size={20}>M</ToggleButton>
		<ToggleButton active={isSolo} disabled={disabled} onClick={onSoloToggle} ariaLabel={copy.solo} tabIndex={tabIndex} size={20}>S</ToggleButton>
	</div>;
}

/** Keep the existing strip controls and gesture callbacks together in both layouts. */
export function TrackControlPanelParameters(props: ParametersProps) {
	return <div className="track-control-panel__controls-row">
		<div className="track-control-panel__slot track-control-panel__slot--pan" data-tcp-slot="pan" tabIndex={-1} role="group" aria-label={props.copy.pan}>
			<PanKnob value={props.pan} disabled={props.disabled || props.panDisabled} onChange={props.onPanChange}
				onGestureStart={props.onPanGestureStart} onGestureEnd={props.onPanGestureEnd} onGestureCancel={props.onPanGestureCancel}
				tabIndex={props.tabIndex} />
		</div>
		<div className="track-control-panel__slot track-control-panel__slot--volume" data-tcp-slot="volume" tabIndex={-1} role="group" aria-label={props.copy.volume}>
			<Slider value={props.volume} defaultValue={props.defaultVolume} disabled={props.disabled} onChange={props.onVolumeChange}
				onGestureStart={props.onVolumeGestureStart} onGestureEnd={props.onVolumeGestureEnd} onGestureCancel={props.onVolumeGestureCancel}
				ariaLabel={props.copy.volume} tabIndex={props.tabIndex} />
		</div>
		<TrackControlPanelMuteSoloButtons {...props} />
	</div>;
}
