/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioHostFailureLabel } from '../audio-host-failure-presentation.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';
import { useSyncExternalStore } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { displayAudioCaptureUnsupportedReason } from '../../recording-display-input.ts';
import EditorHelpTooltip from '../EditorHelpTooltip.tsx';
import { soundscaperAudioHostRuntimeFor } from '../soundscaper-audio-host-runtime.ts';

const EMPTY_SUBSCRIBE = () => () => {};
const EMPTY_SNAPSHOT = () => null;

export function AudioDevicesFlyout({
	copy,
	snapshot,
	controller,
	run,
	displayAudioSupported = true,
	heading = true,
	audioHostRuntime = soundscaperAudioHostRuntimeFor(controller),
}) {
	const hostState = useSyncExternalStore(
		audioHostRuntime?.subscribe ?? EMPTY_SUBSCRIBE,
		audioHostRuntime?.getSnapshot ?? EMPTY_SNAPSHOT,
		audioHostRuntime?.getSnapshot ?? EMPTY_SNAPSHOT,
	);
	const devices = snapshot.audioDevices || {};
	const host = hostState?.host ?? devices.host ?? 'browser';
	const desktop = host !== 'browser';
	const native = desktop && host !== 'electron';
	const hosts = hostState?.hosts ?? [{ id: 'electron', label: 'Electron' }];
	const busy = Boolean(hostState?.pending || snapshot.recording || snapshot.recordingStarting
		|| snapshot.recordingScheduling || snapshot.scheduledRecording);
	const sampleRate = devices.recordingSampleRate || 48_000;
	const sampleRates = [...new Set([8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000, 176_400, 192_000, sampleRate])].sort((left, right) => left - right);
	const inputs = Array.isArray(devices.inputs) ? devices.inputs : [];
	const outputs = Array.isArray(devices.outputs) ? devices.outputs : [];
	const preferredInput = devices.preferredInputDeviceId || 'default';
	const preferredInputChannelCount = devices.preferredInputChannelCount === 2 ? 2 : 1;
	const displayInputSelected = preferredInput === 'display';
	const firefoxDisplayUnsupported = displayAudioCaptureUnsupportedReason() === 'firefox';
	const displayInputSupported = !native && devices.displayInputSupported && displayAudioSupported !== false && !firefoxDisplayUnsupported;
	const displayAudioTooltip = firefoxDisplayUnsupported ? copy.recordingDesktopAudioFirefoxUnsupported : undefined;
	const preferredOutput = devices.preferredOutputDeviceId || '';
	const selectedInput = inputs.find((device) => device.deviceId === preferredInput);
	const stereoUnavailable = Number(selectedInput?.channelCount) === 1;
	const missingInput = preferredInput === 'display'
		? !displayInputSupported
		: preferredInput !== 'default' && !inputs.some((device) => device.deviceId === preferredInput);
	const missingOutput = Boolean(preferredOutput)
		&& !outputs.some((device) => device.deviceId === preferredOutput);
	const outputMessage = devices.outputStatus === 'unavailable'
		? copy.audioDeviceOutputUnavailable
		: devices.outputStatus === 'denied'
			? copy.audioDeviceOutputDenied
			: !devices.outputSupported
				? copy.audioDeviceOutputUnsupported
				: '';

	return (
		<div className="kw-audio-editor__audio-devices-content" data-audio-devices-flyout>
			{heading && <strong>{copy.audioDevices}</strong>}
			{desktop && <label>
				<span>{copy.audioDeviceHost}</span>
				<select aria-label={copy.audioDeviceHost} value={host} disabled={busy || !audioHostRuntime}
					onChange={(event) => run(() => audioHostRuntime.setHost(event.currentTarget.value))}>
					{!hosts.some((entry) => entry.id === host) && <option value={host}>{copy.audioDevicePreferredUnavailable}</option>}
					{hosts.map((entry) => (
						<option key={entry.id} value={entry.id}>{entry.label}</option>
					))}
				</select>
			</label>}
			{hostState?.error && <p className="kw-audio-editor__audio-devices-note" role="alert">{audioHostFailureLabel(hostState.failureCode, copy)}</p>}
			{hostState?.error && <details><summary>{copy.reportItemDiagnostic}</summary>{hostState.error}</details>}
			<label>
				<span className="audio-editor-help-label">{copy.audioInputDevice}
					{firefoxDisplayUnsupported && <EditorHelpTooltip subject={copy.recordingDesktopAudio}
						description={displayAudioTooltip} helpLabel={copy.helpMenu} />}
				</span>
				<select
					aria-label={copy.audioInputDevice}
					title={displayAudioTooltip}
					value={preferredInput}
					disabled={busy || !devices.inputSupported}
					onChange={(event) => run(() => controller.actions.audioDevices.setPreferredInput(event.currentTarget.value))}
				>
					<option value="default">{copy.audioDeviceSystemDefault}</option>
					{missingInput && !(displayInputSelected && firefoxDisplayUnsupported) && <option value={preferredInput}>{copy.audioDevicePreferredUnavailable}</option>}
					{inputs
						.filter((device) => device.deviceId !== 'default')
						.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || formatLocalizedTemplate(copy.recordingInputUnnamedDevice, { number: index + 1 })}</option>)}
					{(displayInputSupported || firefoxDisplayUnsupported) && <option value="display"
						disabled={!displayInputSupported} title={displayAudioTooltip}>{copy.recordingDesktopAudio}</option>}
				</select>
			</label>
			{!desktop && !displayInputSelected && !devices.inputAccess && devices.microphoneInputSupported && (
				<p className="kw-audio-editor__audio-devices-note">{copy.audioDeviceInputAccessRequired}</p>
			)}
			{displayInputSelected && displayInputSupported && (
				<Button
					variant="secondary"
					onClick={() => run(() => controller.actions.audioDevices.configureDisplayInput())}
				>
					{devices.displayCaptureOpen ? copy.audioDeviceChangeDisplaySource : copy.audioDeviceChooseDisplaySource}
				</Button>
			)}
			<fieldset
				className="kw-audio-editor__audio-device-channels"
				role="radiogroup"
				aria-label={copy.audioDeviceRecordingChannels}
			>
				<legend>{copy.audioDeviceRecordingChannels}</legend>
				<label>
					<input
						type="radio"
						name="audio-device-recording-channels"
						value="1"
						checked={preferredInputChannelCount === 1}
						disabled={busy}
						onChange={() => run(() => controller.actions.audioDevices.setPreferredInputChannelCount(1))}
					/>
					<span>{copy.mono}</span>
				</label>
				<label>
					<input
						type="radio"
						name="audio-device-recording-channels"
						value="2"
						checked={preferredInputChannelCount === 2}
						disabled={busy || stereoUnavailable}
						onChange={() => run(() => controller.actions.audioDevices.setPreferredInputChannelCount(2))}
					/>
					<span>{copy.stereo}</span>
				</label>
			</fieldset>
			<p className="kw-audio-editor__audio-devices-note">{copy.audioDeviceRecordingChannelsNote}</p>
			{native && <>
				<label>
					<span>{copy.audioDeviceRecordingSampleRate}</span>
					<select aria-label={copy.audioDeviceRecordingSampleRate} value={sampleRate} disabled={busy}
						onChange={(event) => run(() => controller.actions.audioDevices.setRecordingSampleRate(Number(event.currentTarget.value)))}>
						{sampleRates.map((rate) => <option key={rate} value={rate}>{copy.audioDeviceSampleRateValue.replace('{sampleRate}', String(rate))}</option>)}
					</select>
				</label>
				<p className="kw-audio-editor__audio-devices-note">{copy.audioDeviceRecordingSampleRateNote}</p>
			</>}
			<label>
				<span>{copy.audioOutputDevice}</span>
				<select
					aria-label={copy.audioOutputDevice}
					value={preferredOutput}
					disabled={busy || !devices.outputSupported}
					onChange={(event) => run(() => controller.actions.audioDevices.setOutput(event.currentTarget.value))}
				>
					<option value="">{copy.audioDeviceSystemDefault}</option>
					{missingOutput && <option value={preferredOutput}>{copy.audioDevicePreferredUnavailable}</option>}
					{outputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || formatLocalizedTemplate(copy.recordingInputUnnamedDevice, { number: index + 1 })}</option>)}
				</select>
			</label>
			{outputMessage && <p className="kw-audio-editor__audio-devices-note" role="status">{outputMessage}</p>}
			<div className="kw-audio-editor__audio-devices-actions">
				{!desktop && !snapshot.recordingInputs?.hasOpenInputs && typeof controller.actions.recording.requestInputAccess === 'function' && <Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={() => run(() => controller.actions.recording.requestInputAccess())}
				>{copy.recordingAllowInputs}</Button>}
				{!desktop && snapshot.recordingInputs?.hasOpenInputs && <Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={() => run(() => controller.actions.recording.releaseInputs())}
				>{copy.recordingReleaseInputs}</Button>}
				<Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={() => run(() => audioHostRuntime ? audioHostRuntime.refresh() : controller.actions.audioDevices.refresh())}
				>
					{copy.audioDeviceRefresh}
				</Button>
			</div>
		</div>
	);
}
