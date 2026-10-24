/* SPDX-License-Identifier: AGPL-3.0-only */
import { prepareWaveformGpuGeometry } from './waveform-gpu-geometry.ts';
import type { WaveformGpuDrawOptions, WaveformGpuPlan } from './waveform-gpu-contract.ts';
import { waveformFragmentShader, waveformVertexShader } from './waveform-gpu-shaders.ts';

interface GeometryEntry {
	readonly plan: WaveformGpuPlan;
	readonly key: readonly unknown[];
	readonly buffer: WebGLBuffer;
	readonly count: number;
	readonly bytes: number;
}

interface Resources {
	readonly gl: WebGL2RenderingContext;
	readonly maximumSize: number;
	readonly program: WebGLProgram;
	readonly vao: WebGLVertexArrayObject;
	readonly uniforms: Readonly<Record<string, WebGLUniformLocation>>;
}

/** One browser context, with bounded retained instances and explicit lifetime. */
export class WaveformGpuRuntime {
	private readonly surface: HTMLCanvasElement;
	private resources: Resources | null = null;
	private gl: WebGL2RenderingContext | null = null;
	private readonly entries: GeometryEntry[] = [];
	private readonly colors = new Map<string, Float32Array>();
	private colorSurface: HTMLCanvasElement | null = null;
	private bytes = 0;
	private failed = false;
	private disposed = false;

	constructor(private readonly createCanvas: () => HTMLCanvasElement, private readonly invalidate: () => void,
		surface?: HTMLCanvasElement, private readonly direct = false) {
		this.surface = surface ?? createCanvas();
		this.surface.addEventListener('webglcontextlost', this.onLost);
		this.surface.addEventListener('webglcontextrestored', this.onRestored);
	}

	drawFrame(context: CanvasRenderingContext2D, plan: WaveformGpuPlan, channels: readonly WaveformGpuDrawOptions[], backgroundColor = 'transparent'): boolean {
		if (this.disposed || this.failed || plan.mode !== 'summary') return false;
		const width = context.canvas.width; const height = context.canvas.height;
		if (!(width > 0) || !(height > 0) || width * height > 4_194_304) return false;
		try {
			const resources = this.resources ?? this.initialize();
			if (!resources || resources.gl.isContextLost()) return false;
			const { gl, program, vao, uniforms } = resources;
			if (width > resources.maximumSize || height > resources.maximumSize) return false;
			if (this.surface.width !== width) this.surface.width = width;
			if (this.surface.height !== height) this.surface.height = height;
			const entries = channels.map(options => this.geometry(resources, plan, options));
			if (!entries.length || entries.some(entry => !entry || !this.entries.includes(entry))) return false;
			gl.viewport(0, 0, width, height);
			gl.disable(gl.BLEND); gl.disable(gl.DITHER); gl.disable(gl.DEPTH_TEST);
			gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
			gl.useProgram(program); gl.bindVertexArray(vao);
			gl.uniform2f(uniforms.viewport, width, height);
			for (const [index, options] of channels.entries()) {
				const entry = entries[index]!;
				gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
				gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(0, 1);
				gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 16); gl.vertexAttribDivisor(1, 1);
				gl.uniform2f(uniforms.selection, options.selectionStart, options.selectionEnd);
				if (index === 0) {
					gl.uniform1i(uniforms.backgroundOnly, 1);
					gl.uniform2f(uniforms.selectionPixels, options.selectionStart * options.pixelRatioX, options.selectionEnd * options.pixelRatioX);
					gl.uniform4fv(uniforms.backgroundColor, this.color(backgroundColor));
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				}
				gl.uniform1i(uniforms.backgroundOnly, 0);
				for (const [name, color] of [
					['sampleColor', options.baseSampleColor], ['selectedSampleColor', options.selectedSampleColor],
					['rmsColor', options.baseRmsColor], ['selectedRmsColor', options.selectedRmsColor],
				]) gl.uniform4fv(uniforms[name], this.color(color));
				gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, entry.count);
			}
			if (gl.isContextLost()) return false;
			if (this.direct) return true;
			context.save();
			try { context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(this.surface, 0, 0); }
			finally { context.restore(); }
			return true;
		} catch {
			this.failed = true;
			this.clearResources();
			return false;
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.surface.removeEventListener('webglcontextlost', this.onLost);
		this.surface.removeEventListener('webglcontextrestored', this.onRestored);
		const gl = this.gl;
		this.clearResources();
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
		this.gl = null;
		this.surface.width = 0; this.surface.height = 0;
		if (this.direct) this.surface.remove();
		if (this.colorSurface) { this.colorSurface.width = 0; this.colorSurface.height = 0; }
		this.colorSurface = null; this.colors.clear();
	}

	private readonly onLost = (event: Event): void => {
		event.preventDefault(); this.clearResources(); this.invalidate();
	};
	private readonly onRestored = (): void => {
		this.failed = false; this.invalidate();
	};

	private initialize(): Resources | null {
		const gl = this.surface.getContext('webgl2', {
			alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
		});
		if (!gl) { this.failed = true; return null; }
		this.gl = gl;
		if (gl.isContextLost()) return null;
		const shaders: WebGLShader[] = [];
		let program: WebGLProgram | null = null;
		let vao: WebGLVertexArrayObject | null = null;
		try {
			for (const [kind, source] of [[gl.VERTEX_SHADER, waveformVertexShader], [gl.FRAGMENT_SHADER, waveformFragmentShader]] as const) {
				const shader = gl.createShader(kind);
				if (!shader) throw new Error('Waveform shader allocation failed.');
				shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
				if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Waveform shader compilation failed.');
			}
			program = gl.createProgram(); vao = gl.createVertexArray();
			if (!program || !vao) throw new Error('Waveform GPU allocation failed.');
			for (const shader of shaders) gl.attachShader(program, shader);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Waveform program link failed.');
			const uniforms: Record<string, WebGLUniformLocation> = {};
			for (const name of ['viewport', 'selection', 'sampleColor', 'selectedSampleColor', 'rmsColor', 'selectedRmsColor',
				'backgroundOnly', 'selectionPixels', 'backgroundColor']) {
				const location = gl.getUniformLocation(program, name);
				if (!location) throw new Error('Waveform shader uniform is missing.');
				uniforms[name] = location;
			}
			this.resources = { gl, program, vao, uniforms, maximumSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) };
			return this.resources;
		} catch (error) {
			if (program) gl.deleteProgram(program);
			if (vao) gl.deleteVertexArray(vao);
			throw error;
		} finally { for (const shader of shaders) gl.deleteShader(shader); }
	}

	private geometry({ gl }: Resources, plan: WaveformGpuPlan, options: WaveformGpuDrawOptions): GeometryEntry | null {
		const key = [options.channel, options.width, options.centerY, options.maxAmplitude,
			options.pixelRatioX, options.pixelRatioY, options.channelTop, options.channelHeight,
			options.showRms, options.halfWave, options.amplitudeScale, options.envelopeGain];
		const index = this.entries.findIndex(entry => entry.plan === plan && entry.key.every((value, position) => Object.is(value, key[position])));
		if (index >= 0) {
			const entry = this.entries.splice(index, 1)[0];
			this.entries.push(entry); return entry;
		}
		const data = prepareWaveformGpuGeometry(plan, options);
		if (!data.length || data.byteLength > 1024 ** 2) return null;
		while (this.entries.length >= 32 || this.bytes + data.byteLength > 1024 ** 2) {
			const removed = this.entries.shift();
			if (!removed) break;
			gl.deleteBuffer(removed.buffer); this.bytes -= removed.bytes;
		}
		const buffer = gl.createBuffer();
		if (!buffer) return null;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		if (gl.getError() !== gl.NO_ERROR) { gl.deleteBuffer(buffer); return null; }
		const entry = { plan, key, buffer, count: data.length / 7, bytes: data.byteLength };
		this.entries.push(entry); this.bytes += data.byteLength;
		return entry;
	}

	private color(value: string): Float32Array {
		const cached = this.colors.get(value);
		if (cached) return cached;
		this.colorSurface ??= this.createCanvas();
		this.colorSurface.width = 1; this.colorSurface.height = 1;
		const context = this.colorSurface.getContext('2d');
		if (!context) throw new Error('Waveform palette resolution failed.');
		context.globalCompositeOperation = 'copy'; context.fillStyle = value; context.fillRect(0, 0, 1, 1);
		const serialized = context.fillStyle;
		const match = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/u.exec(serialized);
		const rgba = match ? Float32Array.of(Number(match[1]) / 255, Number(match[2]) / 255,
			Number(match[3]) / 255, match[4] === undefined ? 1 : Number(match[4]))
			: Float32Array.from(context.getImageData(0, 0, 1, 1).data, byte => byte / 255);
		if (this.colors.size >= 64) this.colors.clear();
		this.colors.set(value, rgba); return rgba;
	}

	private clearResources(): void {
		if (this.resources) {
			const { gl, program, vao } = this.resources;
			for (const entry of this.entries) gl.deleteBuffer(entry.buffer);
			gl.deleteProgram(program); gl.deleteVertexArray(vao);
		}
		this.entries.length = 0; this.bytes = 0; this.resources = null;
	}
}
