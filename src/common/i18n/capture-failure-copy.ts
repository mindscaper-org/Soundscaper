/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stable capture failure identities shared by product composition and presentation. */
export const CAPTURE_FAILURE_COPY = Object.freeze({
	captureFailurePermissionDenied: 'Permission to use a capture source was denied.',
	captureFailurePermissionDismissed: 'The capture source request was dismissed.',
	captureFailurePermissionRevoked: 'Permission to use the capture source was revoked.',
	captureFailureDeviceLost: 'The selected capture device is unavailable.',
	captureFailureSourceEnded: 'The capture source ended.',
	captureFailureEncoder: 'The capture encoder failed.',
	captureFailureStorage: 'Capture could not be written to storage.',
	captureFailureRuntime: 'The capture runtime became unavailable.',
	captureFailureFinalization: 'The capture could not be finalized.',
	captureFailureUnknown: 'The capture operation failed.',
	captureUnavailableEmbedded: 'Capture is unavailable in this embedded editor.',
	captureUnavailablePolicy: 'The browser permission policy blocks capture.',
	captureUnavailableDevices: 'This browser cannot access capture devices.',
	captureUnavailableDisplay: 'Screen capture is unavailable.',
	captureUnavailableEncoder: 'A supported video encoder is unavailable.',
	captureUnavailableAudio: 'The capture audio source is unavailable.',
	captureUnavailableStorage: 'Durable capture storage is unavailable.',
	captureUnavailableProbe: 'The captured media cannot be inspected in this runtime.',
	captureUnavailablePlatform: 'Capture is unsupported on this platform.',
	captureUnavailableRuntime: 'The capture runtime could not be initialized.',
});
