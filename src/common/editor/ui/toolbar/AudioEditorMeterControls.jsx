import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flyout } from '@soundscaper/design-system/Flyout';
import { Separator } from '@soundscaper/design-system/Separator';
import { ToolbarButtonGroup } from '@soundscaper/design-system/Toolbar';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import {
	playbackMeterAmplitudeToDb,
	playbackMeterGainFromPosition,
	playbackMeterPercent,
} from '../../playback-meter.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import EditorHelpTooltip from '../EditorHelpTooltip.tsx';
import { MeterPanelGrip } from '../workspace/MeterPanelControls.jsx';
import { formatDb } from '../meter-settings.ts';
import { playbackMeterWithChannels } from '../playback-meter-channel-presentation.ts';
import { AudacityAudioMeter, MeterSettingsFlyout } from './AudioEditorMeters.jsx';

// Browser adaptations of Audacity's RecordLevel.qml/RecordLevelPopup.qml and
// PlaybackLevel.qml/PlaybackMeterCustomisePopup.qml at eee7be71d602bfd852d6d30e58b70a8ab43ed28f.
export function AudacityToolbarFlyoutButton({
	icon,
	ariaLabel,
	flyoutClassName,
	overlayPortal = false,
	children,
}) {
	const popupId = useId();
	const triggerRef = useRef(null);
	const [position, setPosition] = useState(null);
	const setTrigger = useCallback((element) => {
		triggerRef.current = element?.querySelector('button') || null;
	}, []);
	const close = useCallback(() => setPosition(null), []);
	const toggle = (event) => {
		if (position) {
			close();
			return;
		}
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			x: rect.left + rect.width / 2,
			y: rect.bottom,
			direction: window.innerHeight - rect.bottom >= 320 ? 'down' : 'up',
			autoFocus: event.nativeEvent?.detail === 0,
		});
	};

	useEffect(() => {
		triggerRef.current?.setAttribute('aria-expanded', String(Boolean(position)));
	}, [position]);

	const flyout = (
		<Flyout
			id={popupId}
			isOpen={Boolean(position)}
			onClose={close}
			x={position?.x || 0}
			y={position?.y || 0}
			direction={position?.direction || 'down'}
			autoFocus={Boolean(position?.autoFocus)}
			triggerRef={triggerRef}
			showArrow
			closeOnOutsideClick
			closeOnEscape
			ariaLabel={ariaLabel}
			role="dialog"
			className={`kw-audio-editor__audacity-level-flyout ${flyoutClassName}`}
		>
			{children}
		</Flyout>
	);
	const overlayTarget = overlayPortal
		? triggerRef.current?.closest('#kw-audio-editor-design-system')?.querySelector('[data-editor-overlay-layer]')
		: null;
	return (
		<>
			<span ref={setTrigger} className="kw-audio-editor__audacity-level-trigger">
				<button
					type="button"
					className="tool-button tool-button--default tool-button--idle kw-audio-editor__audacity-level-button"
					aria-label={ariaLabel}
					aria-expanded={Boolean(position)}
					aria-controls={popupId}
					onClick={toggle}
				>
					<span className="musescore-icon tool-button__icon" aria-hidden="true">{icon}</span>
				</button>
			</span>
			{overlayTarget ? createPortal(flyout, overlayTarget) : flyout}
		</>
	);
}

function useRecordingMeter(controller) {
	return useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.inputMeter
			|| Math.max(-60, Math.min(0, telemetry.inputMeterDb ?? -60)),
	);
}

function recordingMeterData(dbfs) {
	const peak = dbfs <= -60 ? 0 : 10 ** (dbfs / 20);
	return { dbfs, peak, rms: peak };
}

function recordingMeterChannelCount(snapshot) {
	return snapshot.recordingInputs?.routes?.[snapshot.selectedTrackId]?.channelCount === 2 ? 2 : 1;
}

function recordingMeterSlider(copy, snapshot, controller, run) {
	const inputGain = snapshot.recordingOptions?.inputGain ?? 1;
	const inputGainDb = Math.max(-60, Math.min(6, inputGain > 0 ? 20 * Math.log10(inputGain) : -60));
	return {
		minimum: -60,
		maximum: 6,
		step: 0.1,
		value: inputGainDb,
		defaultValue: 0,
		label: copy.recordLevel,
		valueText: formatDb(inputGainDb),
		onChange: (value) => run(() => controller.actions.recording.setLevel(value <= -60 ? 0 : 10 ** (value / 20))),
	};
}

export function playbackMeterSlider(copy, volume, settings, onChange) {
	const range = settings.type === 'amplitude' ? 60 : settings.dbRange;
	const position = playbackMeterPercent(
		playbackMeterAmplitudeToDb(volume, range),
		settings.type,
		range,
	) / 100;
	const valueText = settings.type === 'amplitude'
		? volume.toFixed(2)
		: volume <= 0
			? '−∞ dB'
			: `${String(Math.round(playbackMeterAmplitudeToDb(volume, range) * 10) / 10).replace('-', '−')} dB`;
	return {
		minimum: 0,
		maximum: 1,
		step: 0.001,
		value: position,
		defaultValue: playbackMeterPercent(0, settings.type, range) / 100,
		label: copy.playbackVolume,
		valueText,
		onChange: (nextPosition) => onChange(playbackMeterGainFromPosition(nextPosition, settings.type, range)),
	};
}

export function RecordingMeterToolbarGroup({
	copy,
	snapshot,
	controller,
	run,
	settings,
	onSettingsChange,
}) {
	const meterValue = useRecordingMeter(controller);
	const meter = typeof meterValue === 'number' ? recordingMeterData(meterValue) : meterValue;
	const meterVisible = Boolean(snapshot.recording || snapshot.monitor?.metering);
	const slider = recordingMeterSlider(copy, snapshot, controller, run);

	return (
		<ToolbarButtonGroup className="kw-audio-editor__recording-meter" gap={4}>
			<AudacityToolbarFlyoutButton
				icon={iconNameToChar('MICROPHONE')}
				ariaLabel={copy.recordLevel}
				flyoutClassName="kw-audio-editor__microphone-level-flyout"
			>
				<RecordingMeterFlyout
					copy={copy}
					snapshot={snapshot}
					meter={meter}
					controller={controller}
					run={run}
					settings={settings}
					onSettingsChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			{meterVisible && settings.position === 'flyout' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				compact
				className="kw-audio-editor__idle-input-meter"
				dataMeterAttribute="idle-input-meter"
			/>}
			{settings.position === 'top' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				slider={slider}
			/>}
		</ToolbarButtonGroup>
	);
}

function RecordingMeterFlyout({
	copy,
	snapshot,
	meter,
	controller,
	run,
	settings,
	onSettingsChange,
}) {
	const slider = recordingMeterSlider(copy, snapshot, controller, run);

	return (
		<div className="kw-audio-editor__microphone-level-content" data-microphone-level-flyout>
			<span className="audio-editor-help-label">
				<strong>{copy.microphoneLevel}</strong>
				<EditorHelpTooltip
					subject={copy.microphoneLevel}
					description={copy.microphoneLevelNote}
					helpLabel={copy.helpMenu}
					hook="microphone-level"
				/>
			</span>
			{settings.position === 'flyout' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				dataMeterAttribute="input-meter"
				slider={slider}
			/>}
			<Separator />
			<MeterSettingsFlyout
				copy={copy}
				settings={settings}
				onChange={onSettingsChange}
				meterKind="recording"
				recordingOptions={(
					<>
						<PreferenceCheckbox
							label={copy.inputMonitoringDetailed}
							checked={Boolean(snapshot.monitor?.enabled)}
							onChange={(enabled) => run(() => controller.actions.recording.setMonitoring(enabled))}
						/>
						<PreferenceCheckbox
							label={copy.microphoneMeteringInactive}
							checked={Boolean(snapshot.monitor?.metering)}
							onChange={(enabled) => run(() => controller.actions.recording.setMetering(enabled))}
						/>
					</>
				)}
			/>
		</div>
	);
}

export function PlaybackMeterToolbarGroup({
	controller,
	copy,
	snapshot,
	settings,
	onSettingsChange,
	clippingEnabled,
	isCompact,
	run,
}) {
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => playbackMeterWithChannels(telemetry.meters));
	return <ToolbarButtonGroup className="kw-audio-editor__playback-meter" gap={6}>
		<AudacityToolbarFlyoutButton
			icon={iconNameToChar('AUDIO')}
			ariaLabel={copy.playbackMeterSettings}
			flyoutClassName="kw-audio-editor__playback-meter-flyout"
		>
			<MeterSettingsFlyout
				copy={copy}
				settings={settings}
				onChange={onSettingsChange}
			/>
		</AudacityToolbarFlyoutButton>
		{settings.position === 'top' && <AudacityAudioMeter
			copy={copy}
			meter={masterMeter}
			settings={settings}
			orientation="horizontal"
			clipped={clippingEnabled && (masterMeter?.peak || 0) >= 1}
			slider={playbackMeterSlider(
				copy,
				snapshot.audioDevices?.playbackGain ?? 1,
				settings,
				(gain) => run(() => controller.actions.audioDevices.setPlaybackGain(gain)),
			)}
			compact={isCompact}
		/>}
	</ToolbarButtonGroup>;
}

export function SidePlaybackMeter({
	controller,
	copy,
	snapshot,
	settings,
	onSettingsChange,
	clippingEnabled,
	run,
	orientation = 'vertical',
}) {
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => playbackMeterWithChannels(telemetry.meters));
	return (
		<aside
			className="kw-audio-editor__side-playback-meter"
			data-side-playback-meter
			aria-label={copy.playbackMeterSettings}
		>
			<MeterPanelGrip />
			<AudacityToolbarFlyoutButton
				overlayPortal
				icon={iconNameToChar('AUDIO')}
				ariaLabel={copy.playbackMeterSettings}
				flyoutClassName="kw-audio-editor__playback-meter-flyout"
			>
				<MeterSettingsFlyout
					copy={copy}
					settings={settings}
					onChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			<AudacityAudioMeter
				copy={copy}
				meter={masterMeter}
				settings={settings}
				orientation={orientation}
				clipped={clippingEnabled && (masterMeter?.peak || 0) >= 1}
				slider={playbackMeterSlider(
					copy,
					snapshot.audioDevices?.playbackGain ?? 1,
					settings,
					(gain) => run(() => controller.actions.audioDevices.setPlaybackGain(gain)),
				)}
			/>
		</aside>
	);
}

export function SideRecordingMeter({
	controller,
	copy,
	snapshot,
	settings,
	onSettingsChange,
	run,
	orientation = 'vertical',
}) {
	const meterValue = useRecordingMeter(controller);
	const meter = typeof meterValue === 'number' ? recordingMeterData(meterValue) : meterValue;
	const slider = recordingMeterSlider(copy, snapshot, controller, run);
	return (
		<aside
			className="kw-audio-editor__side-recording-meter"
			data-side-recording-meter
			aria-label={copy.recordLevel}
		>
			<MeterPanelGrip />
			<AudacityToolbarFlyoutButton
				overlayPortal
				icon={iconNameToChar('MICROPHONE')}
				ariaLabel={copy.recordLevel}
				flyoutClassName="kw-audio-editor__microphone-level-flyout"
			>
				<RecordingMeterFlyout
					copy={copy}
					snapshot={snapshot}
					meter={meter}
					controller={controller}
					run={run}
					settings={settings}
					onSettingsChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			<AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation={orientation}
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				slider={slider}
			/>
		</aside>
	);
}
