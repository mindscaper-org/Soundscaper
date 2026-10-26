/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';
import { createSpectrumIntervalCache } from './spectrum-bin-intervals.ts';

const SPECTRUM_BIN_COUNT = 2_048;

type SpectrumSource = 'input' | 'output';
type SpectrumReader = (source: SpectrumSource, target: Float32Array) => unknown;

interface ParametricEqSpectrumOptions {
	readonly readSpectrum?: SpectrumReader;
	readonly sampleRate: number;
	readonly showInput: boolean;
	readonly showOutput: boolean;
}

interface ParametricEqSpectrumRefs {
	readonly inputCanvasRef: RefObject<HTMLCanvasElement | null>;
	readonly outputCanvasRef: RefObject<HTMLCanvasElement | null>;
}

/** Keep realtime spectrum sampling alive when a subscribing parent rerenders. */
export function useParametricEqSpectrum({
	readSpectrum,
	sampleRate,
	showInput,
	showOutput,
}: ParametricEqSpectrumOptions): ParametricEqSpectrumRefs {
	const inputCanvasRef = useRef<HTMLCanvasElement>(null);
	const outputCanvasRef = useRef<HTMLCanvasElement>(null);
	const readerRef = useRef(readSpectrum);
	const readerAvailable = Boolean(readSpectrum);
	readerRef.current = readSpectrum;

	useEffect(() => {
		if (!readerAvailable || (!showInput && !showOutput)) {
			drawSpectrumCanvas(inputCanvasRef.current, null, sampleRate, 'input');
			drawSpectrumCanvas(outputCanvasRef.current, null, sampleRate, 'output');
			return undefined;
		}
		const input = new Float32Array(SPECTRUM_BIN_COUNT);
		const output = new Float32Array(SPECTRUM_BIN_COUNT);
		const intervals = createSpectrumIntervalCache();
		let animationFrame = 0;
		let previousTime = 0;
		const draw = (time: number) => {
			animationFrame = requestAnimationFrame(draw);
			if (time - previousTime < 33) return;
			previousTime = time;
			const inputMetadata = showInput ? readerRef.current?.('input', input) : null;
			const outputMetadata = showOutput ? readerRef.current?.('output', output) : null;
			drawSpectrumCanvas(inputCanvasRef.current, inputMetadata ? input : null, sampleRate, 'input', inputMetadata, intervals);
			drawSpectrumCanvas(outputCanvasRef.current, outputMetadata ? output : null, sampleRate, 'output', outputMetadata, intervals);
		};
		animationFrame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(animationFrame);
	}, [readerAvailable, sampleRate, showInput, showOutput]);

	return { inputCanvasRef, outputCanvasRef };
}

function drawSpectrumCanvas(
	canvas: HTMLCanvasElement | null,
	values: Float32Array | null,
	sampleRate: number,
	source: SpectrumSource,
	metadata?: unknown,
	intervals?: ReturnType<typeof createSpectrumIntervalCache>,
): void {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const ratio = Math.min(2, window.devicePixelRatio || 1);
	const width = Math.max(1, Math.round(rect.width * ratio));
	const height = Math.max(1, Math.round(rect.height * ratio));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const context = canvas.getContext('2d');
	if (!context) return;
	context.clearRect(0, 0, width, height);
	if (!values) return;
	const nativeRate = typeof metadata === 'object' && metadata !== null && 'sampleRate' in metadata
		&& typeof metadata.sampleRate === 'number' && Number.isFinite(metadata.sampleRate) && metadata.sampleRate > 0
		? metadata.sampleRate : sampleRate;
	const projection = intervals!(width, sampleRate, nativeRate, values.length);
	context.beginPath();
	context.moveTo(0, height);
	for (let pixel = 0; pixel < width; pixel += 2) {
		// Pool the FFT interval covered by each point on the analyser's native clock.
		const [first, end] = projection[pixel / 2]!;
		let db = -120;
		for (let bin = first; bin < end; bin++) if (Number.isFinite(values[bin])) db = Math.max(db, values[bin]!);
		const y = height * (1 - clamp((db + 120) / 120, 0, 1));
		// Paint the pooled interval at its peak height. A single vertex makes a
		// narrow triangle whose antialiased pixels can hide that retained level.
		context.lineTo(Math.max(0, pixel - 1), y);
		context.lineTo(Math.min(width, pixel + 1), y);
	}
	context.lineTo(width, height);
	context.closePath();
	context.fillStyle = source === 'input'
		? 'rgba(82, 155, 255, 0.18)'
		: 'rgba(76, 222, 154, 0.22)';
	context.fill();
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
