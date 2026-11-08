import React, { useRef, useEffect } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { RULER_HEIGHT } from './constants';
import { paintPianoRollRulerTicks } from './paint-piano-roll-ruler';
import type { PianoRollRulerProps } from './types';

/**
 * Timeline ruler for the piano roll, styled to match the main TimelineRuler.
 * Always displays in beats-measures format with the same rendering approach:
 * top/bottom split, sub-pixel alignment, and matching fonts/colors.
 */
export const PianoRollRuler: React.FC<PianoRollRulerProps> = ({
  width,
  scrollX,
  pixelsPerSecond,
  bpm,
  musicalClock,
  beatsPerMeasure,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const height = RULER_HEIGHT;

    // DPR scaling (same approach as main TimelineRuler)
    const MAX_CANVAS_DIMENSION = 32000;
    const baseDpr = window.devicePixelRatio || 1;
    const dpr = Math.min(baseDpr, MAX_CANVAS_DIMENSION / width, MAX_CANVAS_DIMENSION / height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Colors from theme (matching main TimelineRuler)
    const bgColor = theme.background.surface.elevated;
    const textColor = theme.foreground.text.primary;
    const lineColor = theme.border.onElevated;
    const tickColor = theme.audio.timeline.tickMajor;

    // Background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Midpoint divider (matching main ruler's split design)
    const midHeight = Math.floor(height / 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midHeight + 0.5);
    ctx.lineTo(width, midHeight + 0.5);
    ctx.stroke();

    paintPianoRollRulerTicks(ctx, { width, height, scrollX, pixelsPerSecond, bpm, beatsPerMeasure, musicalClock }, { lineColor, textColor, tickColor });
  }, [width, scrollX, pixelsPerSecond, bpm, beatsPerMeasure, musicalClock, theme]);

  return (
    <canvas
      ref={canvasRef}
      className="timeline-ruler"
      style={{
        width,
        height: RULER_HEIGHT,
        flexShrink: 0,
        display: 'block',
        cursor: 'default',
        userSelect: 'none',
      }}
    />
  );
};
