/* SPDX-License-Identifier: AGPL-3.0-only */
import { effectRackMatchesTrack, projectEffectRacks } from './project-effects.ts';
import type { EngineProject } from './types.ts';

let runtime: typeof import('./ai-denoise-runtime.ts') | undefined;

export function projectUsesAiDenoise(project: EngineProject | null | undefined,
	options: Readonly<{ trackId?: unknown; includeMaster?: boolean }> = {},
): boolean {
	return [...projectEffectRacks(project)].some(rack =>
		!(rack.scope === 'master' && options.includeMaster === false)
		&& effectRackMatchesTrack(project, rack, options.trackId)
		&& rack.effects.some(effect => effect.type === 'ai-denoise' && effect.enabled !== false && effect.bypassed !== true));
}

/** Native/model setup and the worklet URL remain outside the editor startup graph. */
export async function prepareAiDenoise(context: BaseAudioContext, project: EngineProject,
	options: Readonly<{ trackId?: unknown; includeMaster?: boolean }> = {},
): Promise<void> {
	if (!runtime && !projectUsesAiDenoise(project, options)) return;
	runtime ??= await import('./ai-denoise-runtime.ts');
	await runtime.prepareAiDenoise(context, project, options);
}
export function createAiDenoiseNode(context: BaseAudioContext, effectId: unknown, channels: number): AudioWorkletNode {
	if (!runtime) throw new Error('AI denoising was not prepared.');
	return runtime.createAiDenoiseNode(context, effectId, channels);
}
export function disposeAiDenoiseNode(node: AudioNode): void { runtime?.disposeAiDenoiseNode(node); }
