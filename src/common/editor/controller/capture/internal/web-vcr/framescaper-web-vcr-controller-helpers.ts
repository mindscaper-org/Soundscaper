/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WebVcrHandshake } from '../../framescaper-web-vcr-controller-types.ts';
import type { CapturePhase } from '../../../../framescaper-capture-domain.ts';
import { WEB_VCR_RESOLUTIONS, type WebVcrCapability } from '../../../../web-vcr-domain.ts';

export async function settleFramescaperWebVcrGuestClose(options: Readonly<{
	phase: string;
	releasePreview(): PromiseLike<void> | void;
	isCurrent(): boolean;
	selectDevices(): void;
}>): Promise<boolean> {
	if (options.phase === 'previewing') await options.releasePreview();
	else if (options.phase !== 'inactive') return false;
	if (!options.isCurrent()) return false;
	options.selectDevices();
	return true;
}

export function unavailableWebVcrCapability(
	reason: 'roadmap-gate' | 'desktop-bridge-unavailable' | 'crop-pipeline-unavailable',
	detail: string | null = null,
): WebVcrCapability {
	return Object.freeze({ status: 'unavailable', reason, detail });
}

export function framescaperCaptureWorkActive(phase: CapturePhase): boolean {
	return ['armed', 'countdown', 'recording', 'paused', 'finalizing'].includes(phase);
}

export function webVcrErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function acceptedWebVcrCapability(handshake: Readonly<WebVcrHandshake>): WebVcrCapability {
	if (handshake.version !== 1 || handshake.capability.status === 'checking') {
		throw new Error('Web VCR desktop handshake is incomplete.');
	}
	return handshake.capability.status === 'available'
		? Object.freeze({ status: 'available', resolutions: Object.freeze(
			handshake.capability.resolutions.filter(value => WEB_VCR_RESOLUTIONS.includes(value)),
		) })
		: handshake.capability;
}
