/* SPDX-License-Identifier: AGPL-3.0-only */
import { CPU_PROFILE_CHANNEL, CPU_PROFILE_CANCEL_CHANNEL, type CpuProfilerBridge, type CpuProfileReading } from '../src/common/editor/cpu-profile-contract.ts';

export function createCpuProfilerPreload(invoke: (channel: string) => Promise<unknown>): CpuProfilerBridge {
	return Object.freeze({
		async capture() { return await invoke(CPU_PROFILE_CHANNEL) as CpuProfileReading; },
		async cancel() { await invoke(CPU_PROFILE_CANCEL_CHANNEL); },
	});
}
