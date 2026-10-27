/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FramescaperNativeServicesCopy } from '../framescaper-native-services-copy.ts';
import type { OfxConsentState } from '../../native-ofx-consent.ts';
import type { NativeQueueState } from '../../native-queue-record.ts';
const OFX_STATES = { discovered: 'ofxStateDiscovered', consented: 'ofxStateConsented', enabled: 'ofxStateEnabled', revoked: 'ofxStateRevoked', quarantined: 'ofxStateQuarantined' } as const;
const QUEUE_STATES = { queued: 'queueStateQueued', running: 'queueStateRunning', paused: 'queueStatePaused', blocked: 'queueStateBlocked',
	'needs-authorization': 'queueStateNeedsAuthorization', completed: 'queueStateCompleted', failed: 'queueStateFailed', cancelled: 'queueStateCancelled' } as const;
export function openFxStateLabel(state: OfxConsentState, copy: FramescaperNativeServicesCopy): string { return copy[OFX_STATES[state]]; }
export function nativeQueueStateLabel(state: NativeQueueState, copy: FramescaperNativeServicesCopy): string { return copy[QUEUE_STATES[state]]; }
