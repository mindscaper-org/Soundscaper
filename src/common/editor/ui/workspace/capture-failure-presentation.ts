/* SPDX-License-Identifier: AGPL-3.0-only */
import { CAPTURE_FAILURE_COPY as ENGLISH } from '../../../i18n/capture-failure-copy.ts';
import type { CaptureFailureCode, CaptureRuntimeUnavailableReason } from '../../framescaper-capture-domain.ts';
const FAILURE_KEYS: Readonly<Record<CaptureFailureCode, keyof typeof ENGLISH>> = Object.freeze({
	'permission-denied': 'captureFailurePermissionDenied', 'permission-dismissed': 'captureFailurePermissionDismissed',
	'permission-revoked': 'captureFailurePermissionRevoked', 'device-lost': 'captureFailureDeviceLost',
	'source-ended': 'captureFailureSourceEnded', 'encoder-failed': 'captureFailureEncoder',
	'storage-failed': 'captureFailureStorage', 'runtime-lost': 'captureFailureRuntime',
	'finalization-failed': 'captureFailureFinalization', unknown: 'captureFailureUnknown',
});
const UNAVAILABLE_KEYS: Readonly<Record<CaptureRuntimeUnavailableReason, keyof typeof ENGLISH>> = Object.freeze({
	'embedded-route': 'captureUnavailableEmbedded', 'permission-policy': 'captureUnavailablePolicy',
	'media-devices-unavailable': 'captureUnavailableDevices', 'display-capture-unavailable': 'captureUnavailableDisplay',
	'video-encoder-unavailable': 'captureUnavailableEncoder', 'audio-packet-source-unavailable': 'captureUnavailableAudio',
	'durable-storage-unavailable': 'captureUnavailableStorage', 'media-probe-unavailable': 'captureUnavailableProbe',
	'unsupported-platform': 'captureUnavailablePlatform', 'runtime-error': 'captureUnavailableRuntime',
});
export function captureFailureLabel(code: CaptureFailureCode, copy: Readonly<Record<string, string | undefined>>): string {
	const key = FAILURE_KEYS[code]; return copy[key] ?? ENGLISH[key];
}
export function captureUnavailableLabel(reason: CaptureRuntimeUnavailableReason, copy: Readonly<Record<string, string | undefined>>): string {
	const key = UNAVAILABLE_KEYS[reason]; return copy[key] ?? ENGLISH[key];
}
