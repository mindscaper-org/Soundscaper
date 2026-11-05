import React, { useState, useCallback } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { mixColors } from '../../../tokens/src/utils/theme-helpers';
import './NoteRect.css';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const EDGE_THRESHOLD = 4; // px from left/right edge to trigger resize cursor

function labelColor(fill: string): string {
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(fill.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

/** Convert MIDI pitch number to note name, e.g. 60 → "C4" */
function pitchToName(pitch: number): string {
  const noteClass = pitch % 12;
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[noteClass]}${octave}`;
}

export type NoteEdge = 'left' | 'right' | 'body';

function edgeAtPointer(event: React.MouseEvent): NoteEdge {
  const rect = event.currentTarget.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const edgeWidth = Math.min(EDGE_THRESHOLD, rect.width / 3);
  return localX <= edgeWidth ? 'left' : localX >= rect.width - edgeWidth ? 'right' : 'body';
}

export interface NoteRectNote {
  id: number;
  pitch: number;
  velocity: number;
  selected?: boolean;
}

export interface NoteRectProps {
  /**
   * The MIDI note data
   */
  note: NoteRectNote;
  /**
   * Horizontal position in pixels (already computed from time)
   */
  x: number;
  /**
   * Vertical position in pixels (already computed from pitch)
   */
  y: number;
  /**
   * Width in pixels (already computed from duration)
   */
  width: number;
  /**
   * Height in pixels (one semitone lane)
   */
  height: number;
  /**
   * Whether the note is currently selected
   */
  isSelected: boolean;
  /**
   * Mouse down handler — receives the note and which edge was clicked
   */
  onMouseDown: (e: React.MouseEvent, note: NoteRectNote, edge: NoteEdge) => void;
  /**
   * Whether this is a ghost note (non-interactive, low opacity)
   */
  ghost?: boolean;
  /**
   * Track color name (e.g. 'blue', 'violet') — uses corresponding clip color from theme
   */
  trackColor?: string;
  /**
   * Additional CSS class names
   */
  className?: string;
}

export const NoteRect: React.FC<NoteRectProps> = ({
  note,
  x,
  y,
  width,
  height,
  isSelected,
  onMouseDown,
  ghost = false,
  trackColor,
  className = '',
}) => {
  const { theme } = useTheme();
  const pr = theme.audio.pianoRoll;
  const [hoverEdge, setHoverEdge] = useState<NoteEdge>('body');

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setHoverEdge(edgeAtPointer(e));
  }, []);

  const cursor = hoverEdge === 'body' ? 'pointer' : 'ew-resize';

  // Fade the paint rather than the label so low-velocity notes remain readable.
  const opacity = ghost ? 1 : 0.5 + (note.velocity / 127) * 0.5;

  const showLabel = width > 30;
  const noteName = pitchToName(note.pitch);

  // Use track color from clip theme when available, otherwise fall back to piano roll theme
  const clipColors = trackColor ? (theme.audio.clip as Record<string, any>)[trackColor] : null; // justified: dynamic string-index into theme tokens (no index signature)
  const noteFill = clipColors?.header ?? pr.noteFill;
  const noteFillSelected = clipColors?.headerSelected ?? pr.noteFillSelected;
  const noteBorder = clipColors?.waveform ?? pr.noteBorder;
  const lane = [1, 3, 6, 8, 10].includes(note.pitch % 12) ? pr.laneBlack : pr.laneWhite;
  const fill = mixColors(noteFill, lane, opacity * 100);
  const selectedFill = mixColors(noteFillSelected, lane, opacity * 100);

  // Lighten the fill for hover state
  const hoverFill = isSelected ? selectedFill : fill;

  const style = {
    '--note-fill': fill,
    '--note-fill-hover': hoverFill,
    '--note-fill-selected': selectedFill,
    '--note-label-color': labelColor(hoverFill),
    '--note-border': noteBorder,
    '--note-border-selected': pr.noteBorderSelected,
    left: x,
    top: y + 1,
    width: Math.max(width, 4),
    height: height - 2,
    cursor: ghost ? 'default' : cursor,
    opacity: ghost ? 0.35 : 1,
    pointerEvents: ghost ? 'none' as const : undefined,
  } as React.CSSProperties;

  return (
    <div
      data-note-id={note.id}
      className={`note-rect ${isSelected ? 'note-rect--selected' : ''} ${className}`}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, note, edgeAtPointer(e));
      }}
    >
      {showLabel && (
        <span className="note-rect__label">
          {noteName}
        </span>
      )}
    </div>
  );
};

export default NoteRect;
