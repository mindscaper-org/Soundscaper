/* SPDX-License-Identifier: AGPL-3.0-only */
import { CPU_PROFILE_PREFIX, type CpuEffectReading } from '../src/common/editor/cpu-profile-contract.ts';

interface Marker {
	key: string;
	ts: number;
	tts: number | null;
	childElapsed: number;
	childCpu: number;
}
interface Total { cpu: number | null; elapsed: number; calls: number }

/** Streaming, bounded attribution; nested sidechain work belongs to its own effect. */
export class CpuProfileAccumulator {
	private readonly threads = new Map<number, Marker[]>();
	private readonly totals = new Map<string, Total>();
	private markers = 0;
	constructor(private readonly rendererPid: number) {}

	add(events: readonly unknown[]): void {
		for (const value of events) {
			if (!value || typeof value !== 'object') continue;
			const event = value as Record<string, unknown>;
			if (event.pid !== this.rendererPid || event.name !== 'TimeStamp' || event.ph !== 'I'
				|| !validNumber(event.tid) || !validNumber(event.ts)) continue;
			const message = (event.args as { data?: { message?: unknown } } | undefined)?.data?.message;
			if (typeof message !== 'string' || !message.startsWith(CPU_PROFILE_PREFIX)) continue;
			if (++this.markers > 1_000_000 || message.length > 2048) throw new Error('CPU profile exceeded its marker limit.');
			const begin = message.startsWith(`${CPU_PROFILE_PREFIX}begin:`);
			if (!begin && !message.startsWith(`${CPU_PROFILE_PREFIX}end:`)) continue;
			const key = message.slice(CPU_PROFILE_PREFIX.length + (begin ? 6 : 4));
			const stack = this.threads.get(event.tid) ?? [];
			this.threads.set(event.tid, stack);
			if (this.threads.size > 128 || stack.length > 4096) throw new Error('CPU profile exceeded its thread limit.');
			if (begin) {
				stack.push({ key, ts: event.ts, tts: validNumber(event.tts) ? event.tts : null, childElapsed: 0, childCpu: 0 });
				continue;
			}
			const start = stack.pop();
			if (!start || start.key !== key) { stack.length = 0; continue; }
			const elapsed = event.ts - start.ts;
			const cpu = start.tts !== null && validNumber(event.tts) ? event.tts - start.tts : null;
			if (elapsed < 0 || cpu !== null && cpu < 0) continue;
			const parent = stack.at(-1);
			if (parent) { parent.childElapsed += elapsed; parent.childCpu += cpu ?? 0; }
			const total = this.totals.get(key) ?? { cpu: 0, elapsed: 0, calls: 0 };
			total.elapsed += Math.max(0, elapsed - start.childElapsed);
			total.cpu = cpu === null || total.cpu === null ? null : total.cpu + Math.max(0, cpu - start.childCpu);
			total.calls++;
			this.totals.set(key, total);
			if (this.totals.size > 4096) throw new Error('CPU profile exceeded its effect limit.');
		}
	}

	finish(durationUs: number): { effects: CpuEffectReading[] } {
		if (!Number.isFinite(durationUs) || durationUs <= 0) throw new Error('Invalid CPU profile duration.');
		return { effects: [...this.totals].map(([key, total]) => ({ key, calls: total.calls,
			cpuPercent: total.cpu === null ? null : total.cpu / durationUs * 100,
			elapsedPercent: total.elapsed / durationUs * 100 })) };
	}
}

function validNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
