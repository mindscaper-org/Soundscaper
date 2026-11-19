/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The commands that write a video proxy, and the recipe that names them.
 *
 * A proxy is a smaller stand-in for one original video source. It is derived
 * media and never editorial authority: clip bounds, source timing, extracted
 * audio, relink identity, and delivery all keep referring to the original. What
 * a proxy owes in return is that it presents the *same pictures at the same
 * times*, only smaller — which is what makes the two interchangeable for
 * preview and what `proveVideoProxyTimingConformance` checks boundary by
 * boundary before any consumer is allowed to show one.
 *
 * Three properties of the encode follow directly from that promise.
 *
 * **Frame for frame.** With an exact encoder time base, `-fps_mode passthrough` writes each decoded frame with
 * the timestamp it arrived with, so a variable-rate original stays variable and
 * a constant-rate one keeps its exact rational rate. Anything that resamples the
 * stream onto a new clock — `-vsync cfr`, a trim — would produce a file
 * whose boundaries no longer line up, and conformance would refuse it. The encoder rate is the reciprocal of the final frame duration; passthrough leaves every earlier PTS untouched.
 *
 * **Display geometry, not coded geometry.** Measured against the pinned
 * `@ffmpeg/core` 0.12.10 (FFmpeg 5.1.4): `-noautorotate` copies the input's
 * display matrix onto the encoded output, and `-metadata:s:v:0 rotate=0` does
 * not clear it because the mov muxer prefers the side data. A proxy written that
 * way declares a rotation that the preview — which already applies the
 * original's display geometry itself — would then apply a second time. Left to
 * autorotate, the decode turns the frames and the output carries no matrix at
 * all. `setsar=1` settles the other half: Chromium applies a stored pixel aspect
 * to `videoWidth` while Firefox ignores it, so a proxy that kept the ratio would
 * present at two different sizes depending on who opened it. The proxy is
 * therefore square-pixelled and already turned, which is the same convention the
 * export follows.
 *
 * **Its own size, decided in the filtergraph.** The generator port is handed the
 * original as a `Blob` and its identity — never a decoded width and height — so
 * the clamp that stops a small source being blown up into a larger "proxy" has
 * to survive the filtergraph parser rather than be computed in JavaScript.
 */

export interface VideoProxyGenerationRecipe extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly version: number;
}

/**
 * The one maintained proxy recipe, as the candidate observer reads it.
 *
 * A recipe is an identity and nothing else — the observer captures exactly `id`
 * and `version` and refuses a record carrying anything more, because those two
 * are what the attachment persists and what a later consumer compares before
 * trusting a body. What the recipe *means* is the output below, which the
 * command is built from.
 */
export const VIDEO_PROXY_GENERATION_RECIPE: VideoProxyGenerationRecipe = Object.freeze({
	id: 'framescaper-video-proxy-h264-540-v2',
	version: 2,
});

/**
 * What that recipe produces.
 *
 * H.264 in MP4 is what the shipped delivery tier already encodes, which keeps a
 * preview-only derivative from being the thing that introduces an uncleared
 * codec, and 540 is the height a proxy is clamped down to.
 */
export const VIDEO_PROXY_GENERATION_OUTPUT = Object.freeze({
	maximumHeight: 540,
	mimeType: 'video/mp4',
	extension: 'mp4',
});

export interface VideoProxyGenerationRequest {
	readonly inputPath: string;
	readonly outputPath: string;
	/**
	 * The original's timescale, when the caller holds its timing view. The mov
	 * muxer picks its own otherwise, and a timescale that cannot express the
	 * original's boundaries rounds them — which conformance refuses. A caller
	 * that is not sure states nothing rather than pinning the wrong one.
	 */
	readonly timescale?: number;
	/** Encoder rate sets the final packet duration; passthrough retains all PTS. */
	readonly finalFrameDurationTicks?: bigint;
}

/** The scale-and-square filter, escaped as the filtergraph parser reads it. */
export function videoProxyGenerationFilter(): string {
	// Resample the display aspect before removing SAR. Both coded dimensions
	// must be positive even integers for H264/yuv420p, including a 2x1 source.
	const height = `max(2\\,trunc(min(${String(VIDEO_PROXY_GENERATION_OUTPUT.maximumHeight)}\\,ih)/2)*2)`;
	return `scale=w=max(2\\,trunc(oh*dar/2+0.5)*2):h=${height},setsar=1`;
}

/** One proxy, written from one original, at the recipe's size. */
export function buildVideoProxyGenerationArgs(
	request: VideoProxyGenerationRequest,
): readonly string[] {
	const input = nonEmpty(request?.inputPath, 'input');
	const output = nonEmpty(request?.outputPath, 'output');
	const timescale = request?.timescale === undefined ? null : videoTrackTimescale(request.timescale);
	const timingArgs = encoderTimingArgs(timescale, request.finalFrameDurationTicks);
	return Object.freeze([
		'-hide_banner', '-nostdin', '-y',
		'-i', input,
		// One video stream and nothing else. A proxy carrying its own audio would
		// invite a second clock into a picture-only derivative; the original keeps
		// owning the sound, which is what `ignore-proxy-container-audio-v1` states.
		'-map', '0:v:0', '-an', '-sn', '-dn',
		'-vf', videoProxyGenerationFilter(),
		'-fps_mode', 'passthrough',
		'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
		'-pix_fmt', 'yuv420p',
		...timingArgs,
		// A preview seeks constantly, and a proxy whose index sits at the end of
		// the file makes the first seek wait for the whole body to arrive.
		'-movflags', '+faststart',
		output,
	]);
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(`A video proxy generation ${name} path is required.`);
	}
	return value;
}

function videoTrackTimescale(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError('A video proxy timescale must be a positive safe integer.');
	}
	return value;
}

function encoderTimingArgs(timescale: number | null, duration: bigint | undefined): string[] {
	if (duration !== undefined && (timescale === null || typeof duration !== 'bigint' || duration <= 0n)) {
		throw new RangeError('A positive final frame duration requires the original timescale.');
	}
	if (timescale === null) return [];
	const args = ['-enc_time_base', `1/${timescale}`, '-video_track_timescale', String(timescale)];
	if (duration !== undefined) {
		let numerator = BigInt(timescale), denominator = duration;
		let a = numerator, b = denominator;
		while (b) { const remainder = a % b; a = b; b = remainder; }
		numerator /= a; denominator /= a;
		if (numerator > 2147483647n || denominator > 2147483647n) {
			throw new RangeError('This proxy recipe cannot preserve the original final frame duration.');
		}
		args.push('-r', `${numerator}/${denominator}`);
	}
	return args;
}
