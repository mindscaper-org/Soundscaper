/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CapturePacket, CapturePhase } from '../../../framescaper-capture-domain.ts';
import type { FramescaperCaptureDurablePort, FramescaperCaptureDurableSession } from '../framescaper-capture-session-types.ts';
import type { FramescaperCaptureActiveTimeClock } from './framescaper-capture-active-time-clock.ts';
import type { FramescaperCaptureMetrics } from './framescaper-capture-metrics.ts';

interface PacketAdmission {
	session(): FramescaperCaptureDurableSession | null;
	clock(): FramescaperCaptureActiveTimeClock | null;
	metrics(): FramescaperCaptureMetrics | null;
	phase(): CapturePhase;
	beforeAppend(): Promise<void>;
	append: FramescaperCaptureDurablePort['append'];
	setSession(session: FramescaperCaptureDurableSession): void;
	admitDurablePacket(): void;
	notify(): void;
}
/** Observe capture timing before storage, and acknowledge only journal-owned packets. */
export function createFramescaperCapturePacketAdmission(dependencies: PacketAdmission) {
	return async (packet: Readonly<CapturePacket>): Promise<void> => {
		const clock = dependencies.clock(), metrics = dependencies.metrics();
		if (!dependencies.session() || !clock || !metrics) throw new Error('Capture packet arrived before durable admission.');
		const phase = dependencies.phase();
		if (!['recording', 'paused', 'finalizing'].includes(phase)) throw new Error(`Capture packet arrived while ${phase}.`);
		const observedActiveTimeUs = clock.activeTimeUsAt(packet.receiptTimeMs);
		await dependencies.beforeAppend();
		const session = dependencies.session();
		if (!session) throw new Error('Capture packet lost its durable admission.');
		dependencies.setSession(await dependencies.append(session, packet));
		dependencies.admitDurablePacket();
		metrics.observe(packet, observedActiveTimeUs);
		dependencies.notify();
	};
}
