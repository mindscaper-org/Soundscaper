import { useCallback, useEffect, useRef, useState } from 'react';

import { cancelVideoPreviewMediaSeek, seekVideoPreviewMedia } from '../../controller/clip-video/video-preview-media-seek.ts';
import { resolveVideoDisplayGeometry } from '../../video-display-geometry.ts';
import '../audio-editor-design-system/23-source-monitor.css';
import EditorControlLabel from '../EditorControlLabel.tsx';
import { useSourceMonitorMedia } from './use-source-monitor-media.ts';

/**
 * The source monitor: one video source shown on its own frame grid.
 *
 * The controller owns the playhead in source frames; this element's clock only
 * renders it. While the media plays, the clock is read back as the frame it is
 * inside — a conversion, never a second authority — so pausing anywhere leaves
 * the monitor on a frame that can be marked.
 */
export default function SourceMonitorPanel({ controller, snapshot, copy, run, blocked, panelActive = true }) {
	const videoRef = useRef(null);
	const playbackSessionRef = useRef(null);
	const playingRef = useRef(false);
	const endedNaturally = useRef(false);
	const playRequest = useRef(0);
	const [playing, setPlaying] = useState(false);
	const [decodedSize, setDecodedSize] = useState(null);
	const view = controller.actions.video.sourceMonitor.view();
	const visual = view.sourceId ? controller.actions.video.getSourceVisualData(view.sourceId, { sourceMonitor: true }) : null;
	const { mediaUrl, pending } = useSourceMonitorMedia(visual);
	const disabled = blocked || snapshot.readOnly;
	const setVideoRef = useCallback((media) => {
		if (videoRef.current !== media) cancelVideoPreviewMediaSeek(videoRef.current);
		videoRef.current = media;
	}, []);
	const readDecodedSize = (event) => {
		const { videoWidth: width, videoHeight: height } = event.currentTarget;
		if (!width || !height) return;
		setDecodedSize(previous => previous?.mediaUrl === mediaUrl && previous.width === width && previous.height === height
			? previous : { mediaUrl, width, height });
	};
	const geometry = decodedSize && decodedSize.mediaUrl === mediaUrl
		? resolveVideoDisplayGeometry(visual?.source?.characteristics, decodedSize)
		: null;
	const pictureStyle = geometry?.reconciliation === 'residual' && geometry.residualRotationDegrees === 0
		? {
			aspectRatio: `${geometry.displayWidth} / ${geometry.displayHeight}`,
			height: 'auto',
			objectFit: 'fill',
			width: `min(100%, calc(100% * ${geometry.displayWidth / geometry.displayHeight} / var(--source-monitor-viewport-aspect)))`,
		}
		: undefined;

	// Playing a source is a viewing action; stopping it is what makes the
	// controller's frame authoritative again.
	const stop = useCallback(() => {
		playbackSessionRef.current = null;
		// pause() can dispatch a final timeupdate before React commits the state.
		playRequest.current += 1;
		if (playingRef.current) cancelVideoPreviewMediaSeek(videoRef.current);
		playingRef.current = false;
		videoRef.current?.pause?.();
		setPlaying(false);
	}, []);
	useEffect(() => {
		endedNaturally.current = false;
		stop();
	}, [stop, view.sourceId, view.openRevision, mediaUrl]);
	useEffect(() => {
		if (panelActive) return;
		if (playingRef.current && videoRef.current) controller.actions.video.sourceMonitor.seekMediaTime(Number(videoRef.current.currentTime) || 0);
		stop();
	}, [controller, panelActive, stop]);
	const seekPausedPicture = useCallback((media) => {
		if (!media || playingRef.current || !Number.isFinite(view.mediaSeconds)) return;
		// Preserve the native ended state so Play can restart the source.
		if (endedNaturally.current && media.ended && view.positionFrame === view.sourceFrameCount - 1) return;
		endedNaturally.current = false;
		try { seekVideoPreviewMedia(media, view.mediaSeconds, 0); }
		catch { /* The metadata callback retries when the element is ready. */ }
	}, [view.mediaSeconds, view.positionFrame, view.sourceFrameCount]);
	useEffect(() => {
		seekPausedPicture(videoRef.current);
	}, [mediaUrl, playing, seekPausedPicture, view.openRevision]);

	if (!view.sourceId) {
		return <div className="kw-audio-editor__source-monitor" data-source-monitor="empty">
			<div className="kw-audio-editor__source-monitor-picture"><p className="kw-audio-editor__panel-empty">{copy.sourceMonitorEmpty}</p></div>
		</div>;
	}

	const publish = (frame) => run(() => controller.actions.video.sourceMonitor.seek(frame));
	const capturePlayback = () => {
		const playbackSession = playbackSessionRef.current;
		if (playingRef.current && videoRef.current && playbackSession) {
			const current = controller.actions.video.sourceMonitor.view();
			// A new render cannot lend a reopened session's identity to an old clock.
			if (current.sourceId !== playbackSession.sourceId || current.openRevision !== playbackSession.openRevision) return;
			controller.actions.video.sourceMonitor.seekMediaTime(Number(videoRef.current.currentTime) || 0);
		}
	};
	const withCurrentFrame = (operation) => run(() => {
		capturePlayback();
		return operation();
	});
	const step = (delta) => {
		run(() => {
			capturePlayback();
			stop();
			return controller.actions.video.sourceMonitor.step(delta);
		});
	};
	const togglePlay = () => {
		const media = videoRef.current;
		if (!media || !panelActive) return;
		if (playingRef.current) {
			stop();
			run(() => controller.actions.video.sourceMonitor.seekMediaTime(Number(media.currentTime) || 0));
			return;
		}
		playbackSessionRef.current = { sourceId: view.sourceId, openRevision: view.openRevision };
		endedNaturally.current = false;
		playingRef.current = true;
		setPlaying(true);
		const request = ++playRequest.current;
		void media.play?.().catch(() => { if (playRequest.current === request) stop(); });
	};

	return <div
		className="kw-audio-editor__source-monitor"
		data-source-monitor={view.sourceId}
		data-source-monitor-frame={view.positionFrame}
		data-source-monitor-mark-in={view.markIn == null ? '' : view.markIn}
		data-source-monitor-mark-out={view.markOut == null ? '' : view.markOut}
	>
		<div className="kw-audio-editor__source-monitor-picture">
			{mediaUrl
				? <video
					ref={setVideoRef}
					data-source-monitor-video
					src={mediaUrl}
					style={pictureStyle}
					muted
					playsInline
					preload="auto"
					aria-label={`${copy.panelSourceMonitor}: ${view.sourceName || copy.videoClip}`}
					onLoadedMetadata={(event) => { readDecodedSize(event); seekPausedPicture(event.currentTarget); }}
					onResize={readDecodedSize}
					onTimeUpdate={capturePlayback}
					onEnded={() => run(() => {
						if (playingRef.current) endedNaturally.current = true;
						capturePlayback();
						stop();
					})}
				/>
				: <p className="kw-audio-editor__panel-empty" role="status">{pending ? copy.loading : copy.videoPreviewUnavailable}</p>}
		</div>
		<p className="kw-audio-editor__source-monitor-readout">
			<output aria-label={copy.sourceMonitorPosition} data-source-monitor-timecode={view.timecodeLabel}>
				{view.timecodeLabel}
			</output>
			<span data-source-monitor-range>
				{view.markIn == null && view.markOut == null
					? copy.sourceMonitorUnmarked
					: `${view.markIn == null ? '—' : String(view.markIn)} · ${view.markOut == null ? '—' : String(view.markOut)}`}
			</span>
		</p>
		<div className="kw-audio-editor__source-monitor-transport">
			<button
				type="button"
				data-source-monitor-action="previous"
				aria-label={copy.previousFrame}
				onClick={() => step(-1)}
			>‹</button>
			<button
				type="button"
				data-source-monitor-action="play"
				aria-label={playing ? copy.pause : copy.play}
				aria-pressed={playing}
				disabled={!mediaUrl}
				onClick={togglePlay}
			>{playing ? '❚❚' : '▶'}</button>
			<button
				type="button"
				data-source-monitor-action="next"
				aria-label={copy.nextFrame}
				onClick={() => step(1)}
			>›</button>
			<label className="kw-audio-editor__source-monitor-scrub">
				<EditorControlLabel className="kw-audio-editor__visually-hidden">{copy.sourceMonitorPosition}</EditorControlLabel>
				<input
					type="range"
					min={0}
					max={Math.max(0, view.sourceFrameCount - 1)}
					step={1}
					value={view.positionFrame}
					data-source-monitor-scrub
					onChange={(event) => {
						stop();
						publish(Number(event.currentTarget.value));
					}}
				/>
			</label>
		</div>
		<div className="kw-audio-editor__source-monitor-marks">
			<button
				type="button"
				data-source-monitor-action="mark-in"
				onClick={() => withCurrentFrame(() => controller.actions.video.sourceMonitor.markIn())}
			>{copy.sourceMarkIn}</button>
			<button
				type="button"
				data-source-monitor-action="mark-out"
				onClick={() => withCurrentFrame(() => controller.actions.video.sourceMonitor.markOut())}
			>{copy.sourceMarkOut}</button>
			<button
				type="button"
				data-source-monitor-action="clear-marks"
				disabled={view.markIn == null && view.markOut == null}
				onClick={() => run(() => controller.actions.video.sourceMonitor.clearMarks())}
			>{copy.sourceClearMarks}</button>
		</div>
		<div className="kw-audio-editor__source-monitor-edits">
			<button
				type="button"
				data-source-monitor-action="match-frame"
				onClick={() => run(() => controller.actions.video.matchFrame())}
			>{copy.editMatchFrame}</button>
			<button
				type="button"
				data-source-monitor-action="replace"
				disabled={disabled}
				onClick={() => withCurrentFrame(() => controller.actions.video.replace())}
			>{copy.editReplace}</button>
		</div>
	</div>;
}
