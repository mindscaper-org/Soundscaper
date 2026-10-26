/* SPDX-License-Identifier: AGPL-3.0-only */
import { WaveformGpuRuntime } from './internal/waveform-gpu-runtime.ts';
import type { WaveformGpuDrawOptions, WaveformGpuPlan } from './internal/waveform-gpu-contract.ts';

interface Display {
	readonly runtime: WaveformGpuRuntime;
	readonly surface: HTMLCanvasElement;
	readonly users: Set<symbol>;
	pixels: number;
}
interface Owner {
	readonly runtime: WaveformGpuRuntime | null;
	readonly listeners: Set<() => void>;
	readonly displays: Map<HTMLCanvasElement, Display>;
	references: number;
	pixels: number;
}
const owners = new WeakMap<object, Owner>();

/** Bound direct display to eight contexts, 32 MiB of pixels and 8 MiB of instances. */
export function acquireWaveformGpuRenderer(owner: object, createCanvas: () => HTMLCanvasElement, invalidate: () => void,
	createDisplaySurface?: (canvas: HTMLCanvasElement) => HTMLCanvasElement | null) {
	let entry = owners.get(owner);
	if (!entry) {
		const listeners = new Set<() => void>();
		const runtime = createDisplaySurface ? null : new WaveformGpuRuntime(createCanvas, () => { for (const listener of listeners) listener(); });
		entry = { runtime, listeners, references: 0, displays: new Map(), pixels: 0 }; owners.set(owner, entry);
	}
	const shared = entry;
	const notify = () => invalidate();
	shared.references++; shared.listeners.add(notify);
	const owned = new Set<HTMLCanvasElement>();
	const user = Symbol();
	let released = false;
	function releaseOwner(canvas: HTMLCanvasElement) {
		if (!owned.delete(canvas)) return;
		const display = shared.displays.get(canvas);
		if (display) {
			display.users.delete(user);
			if (!display.users.size) { display.runtime.dispose(); shared.displays.delete(canvas); shared.pixels -= display.pixels; }
		}
	}
	function drawFrame(context: CanvasRenderingContext2D, plan: WaveformGpuPlan,
		channels: readonly WaveformGpuDrawOptions[], backgroundColor?: string): boolean {
		if (released) return false;
		if (!createDisplaySurface) return shared.runtime?.drawFrame(context, plan, channels, backgroundColor) ?? false;
		const canvas = context.canvas;
		const pixels = canvas.width * canvas.height;
		let display = shared.displays.get(canvas);
		if (shared.pixels - (display?.pixels ?? 0) + pixels > 8_388_608 || (!display && shared.displays.size >= 8)) {
			if (display) display.surface.style.visibility = 'hidden';
			return false;
		}
		if (!display) {
			const surface = createDisplaySurface(canvas);
			if (!surface) return false;
			const runtime = new WaveformGpuRuntime(createCanvas, () => { for (const listener of shared.listeners) listener(); }, surface, true);
			display = { runtime, surface, pixels: 0, users: new Set() }; shared.displays.set(canvas, display);
		}
		owned.add(canvas); display.users.add(user);
		shared.pixels += pixels - display.pixels; display.pixels = pixels;
		const drawn = display.runtime.drawFrame(context, plan, channels, backgroundColor);
		display.surface.style.visibility = drawn ? 'visible' : 'hidden';
		return drawn;
	}
	return {
		draw(context: CanvasRenderingContext2D, plan: WaveformGpuPlan, options: WaveformGpuDrawOptions) {
			return drawFrame(context, plan, [options]);
		},
		drawFrame, releaseOwner,
		release() {
			if (released) return;
			for (const canvas of owned) releaseOwner(canvas);
			released = true; shared.listeners.delete(notify); shared.references--;
			if (!shared.references) { shared.runtime?.dispose(); owners.delete(owner); }
		},
	};
}
