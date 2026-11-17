/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAudioWorkletLoadOnce } from '../audio-worklet-load-once.ts';
import { AI_DENOISE_CONNECT, AI_DENOISE_TYPE, AI_DENOISE_RATE, aiDenoiseRackGeometry } from '../first-party-effects/ai-denoise/contract.ts';
import { effectRackMatchesTrack, projectEffectRacks } from './project-effects.ts';
import { rackEffectInputChannelCount, type RackChannelProject } from '../rack-effect-channel-width.ts';
import type { EngineProject } from './types.ts';
import { effectGraphKey } from './effect-rack-node-registry.ts';

const worklet = createAudioWorkletLoadOnce(async context => {
	const url = import.meta.env?.DEV || import.meta.env?.PROD
		? (await import('../first-party-effects/ai-denoise/worklet.ts?worker&url')).default
		: new URL('../first-party-effects/ai-denoise/worklet.ts', import.meta.url);
	await context.audioWorklet.addModule(String(url));
});
interface Entry { readonly node: AudioWorkletNode; readonly channels: number; readonly isAlive: () => boolean; readonly dispose: () => void; }
const prepared = new WeakMap<BaseAudioContext, Map<string, Entry>>();
const nodes = new WeakMap<AudioNode, Entry>();
const preparing = new WeakMap<BaseAudioContext, Promise<void>>();

/** Open, authenticate and measure inference before the transport schedules audio. */
export async function prepareAiDenoise(context: BaseAudioContext, project: EngineProject,
	options: Readonly<{ trackId?: unknown; includeMaster?: boolean }> = {},
): Promise<void> {
	const next = (preparing.get(context) ?? Promise.resolve()).catch(() => undefined)
		.then(() => prepareOwned(context, project, options));
	preparing.set(context, next);
	try { await next; } finally { if (preparing.get(context) === next) preparing.delete(context); }
}
async function prepareOwned(context: BaseAudioContext, project: EngineProject,
	options: Readonly<{ trackId?: unknown; includeMaster?: boolean }>,
): Promise<void> {
	let entries = prepared.get(context);
	if (!entries) { entries = new Map(); prepared.set(context, entries); }
	const effects = [...projectEffectRacks(project)].filter(rack =>
		!(rack.scope === 'master' && options.includeMaster === false)
		&& effectRackMatchesTrack(project, rack, options.trackId))
		.flatMap(rack => rack.effects.filter(effect => effect.type === AI_DENOISE_TYPE && effect.enabled !== false && effect.bypassed !== true)
			.map(effect => ({ rack, effect })));
	if (!effects.length) { for (const entry of entries.values()) entry.dispose(); entries.clear(); return; }
	if (!('scapeDesktop' in globalThis) && !('soundscaperDesktop' in globalThis)) {
		throw new Error('Real-time AI denoising requires the desktop app and DPDFNet2 installed in Model Manager.');
	}
	await worklet.ensure(context);
	const selected = new Set<string>();
	try {
		for (const { rack, effect } of effects) {
			const key = effectGraphKey(rack.scope, rack.targetId, effect.id);
			if (selected.has(key)) throw new Error('AI denoising requires unique effect identities within a rack.');
			selected.add(key);
			const channels = rackEffectInputChannelCount(project as RackChannelProject, rack.scope, rack.targetId, effect.id);
			aiDenoiseRackGeometry(context.sampleRate, channels);
			const previous = entries.get(key);
			if (previous?.channels === channels && previous.isAlive()) continue;
			previous?.dispose();
			entries.set(key, await openNode(context, channels));
		}
		for (const [id, entry] of entries) if (!selected.has(id)) { entry.dispose(); entries.delete(id); }
	} catch (error) { for (const entry of entries.values()) entry.dispose(); entries.clear(); throw error; }
}
export function createAiDenoiseNode(context: BaseAudioContext, effectId: unknown, channels: number): AudioWorkletNode {
	const entries = prepared.get(context), entry = entries?.get(String(effectId));
	if (!entry || !entry.isAlive() || entry.channels !== channels) throw new Error('AI denoising was not prepared for this audio rack.');
	entries!.delete(String(effectId));
	return entry.node;
}
export function disposeAiDenoiseNode(node: AudioNode): void { nodes.get(node)?.dispose(); }

async function openNode(context: BaseAudioContext, channels: number): Promise<Entry> {
	const node = new AudioWorkletNode(context, 'kw-ai-denoise', {
		numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channels], channelCount: channels,
		channelCountMode: 'explicit', channelInterpretation: 'discrete', processorOptions: { channelCount: channels },
	});
	const pair = new MessageChannel();
	let disposed = false;
	let cancelInitialization: ((error: Error) => void) | undefined;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		nodes.delete(node);
		context.removeEventListener('statechange', onState);
		node.removeEventListener('processorerror', onFailure);
		node.port.removeEventListener('message', onMessage);
		try { node.port.postMessage({ type: 'dispose' }); } catch { /* Context already closed. */ }
		try { pair.port2.postMessage({ type: 'close' }); } catch { /* Port already transferred. */ }
		pair.port2.close(); node.disconnect();
		cancelInitialization?.(new Error('AI denoising initialization was cancelled.'));
	};
	const onState = (): void => { if (context.state === 'closed') dispose(); };
	const onFailure = (): void => dispose();
	const onMessage = ({ data }: MessageEvent): void => { if (data?.type === 'error') dispose(); };
	context.addEventListener('statechange', onState);
	node.addEventListener('processorerror', onFailure);
	node.port.addEventListener('message', onMessage);
	const entry: Entry = { node, channels, isAlive: () => !disposed, dispose };
	nodes.set(node, entry);
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => finish(new Error('AI denoising initialization timed out.')), 35_000);
			const finish = (error?: Error): void => {
				if (settled) return;
				settled = true; cancelInitialization = undefined;
				clearTimeout(timer); node.port.onmessage = null; pair.port2.onmessage = null;
				if (error) reject(error); else resolve();
			};
			cancelInitialization = finish;
			node.port.onmessage = ({ data }: MessageEvent): void => {
				if (data?.type === 'attached') finish();
				else if (data?.type === 'error') finish(new Error('AI denoising failed to initialize.'));
			};
			pair.port2.onmessage = ({ data }: MessageEvent): void => {
				if (data?.type === 'ready') node.port.postMessage({ type: 'attach' }, [pair.port2]);
				else finish(new Error(typeof data?.message === 'string' ? data.message : 'AI denoising is unavailable.'));
			};
			pair.port2.onmessageerror = (): void => finish(new Error('AI denoising initialization failed.'));
			pair.port2.start();
			const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join('');
			window.postMessage({ type: AI_DENOISE_CONNECT, request: { sessionId, sampleRate: AI_DENOISE_RATE, channelCount: channels } }, window.location.origin, [pair.port1]);
		});
		return entry;
	} catch (error) { dispose(); throw error; }
}
