/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
export const TIMECODE_SYNC_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze({
	title: 'Timecode synchronization',
	receive: 'Receive timecode', off: 'Off', mtc: 'MTC (MIDI)', ltc: 'LTC (audio)',
	sendMtc: 'Send MTC', sendLtc: 'Send LTC', rate: 'Timecode frame rate',
	fps24: '24 fps', fps25: '25 fps', fps2997: '29.97 fps (drop-frame)', fps30: '30 fps',
	offset: 'Timecode at timeline zero (seconds)',
	midiInput: 'MTC MIDI input', midiOutput: 'MTC MIDI output',
	audioInput: 'LTC audio input', audioOutput: 'LTC audio output',
	inputChannel: 'LTC input channel', outputChannel: 'LTC output channel',
	defaultDevice: 'System default', selectPort: 'Select MIDI port',
	refresh: 'Refresh audio devices', midiAccess: 'Connect MIDI devices',
	apply: 'Apply synchronization', disable: 'Disable synchronization', close: 'Close',
	inactive: 'Synchronization is off.', waiting: 'Waiting for timecode.',
	locked: 'Receiving timecode.', sending: 'Sending timecode with playback.',
	hint: 'Settings apply to this open project until you disable synchronization or close the workspace. MTC supplies its own receive rate; select the rate for LTC input and timecode output. Receive uses normal playback with looping and recording disabled. Signal loss pauses playback after 0.5 seconds. Reverse timecode locates without playing.',
	routingHint: 'Route LTC to a dedicated audio output and keep it out of your monitoring speakers. Input audio processing is disabled. Channels are numbered from 1.',
}) });
export function resolveTimecodeSyncCopy(copy: Readonly<Record<string, unknown>> = {}) {
	return resolveEditorCopyScope('timecodeSync', TIMECODE_SYNC_COPY_BY_LOCALE.en, copy);
}
