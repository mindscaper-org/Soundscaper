/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIO_DEVICE_COPY_BY_LOCALE } from '../../i18n/audio-device-copy.js';
import type { AudioHostFailureCode } from './audio-host-failure.ts';
import { formatLocalizedTemplate } from './localization-template.ts';
const KEYS = { unavailable: 'audioHostUnavailable', 'recording-active': 'audioHostRecordingActive', closed: 'audioHostWorkspaceClosed',
	'session-close': 'audioHostSessionCloseFailed', 'rate-mismatch': 'audioHostRateUnavailable', startup: 'audioHostStartFailed',
	inventory: 'audioHostInventoryUnavailable', 'session-open': 'audioHostSessionOpenFailed', 'device-loss': 'audioHostDeviceLost',
	availability: 'audioHostAvailabilityFailed', operation: 'audioHostOperationFailed',
} satisfies Record<AudioHostFailureCode, keyof typeof AUDIO_DEVICE_COPY_BY_LOCALE.en>;
export function audioHostFailureLabel(code: AudioHostFailureCode | null | undefined, copy: Readonly<Record<string, string>>): string {
	const key = KEYS[code ?? 'operation'];
	return formatLocalizedTemplate(copy[key] || AUDIO_DEVICE_COPY_BY_LOCALE.en[key], { settings: copy.audioDevices || AUDIO_DEVICE_COPY_BY_LOCALE.en.audioDevices });
}
