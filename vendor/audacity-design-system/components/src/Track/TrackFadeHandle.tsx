import React from 'react';
import { trackFadeHandleGeometry } from './track-fade-handle-geometry';
import './Track.css';

export interface TrackFadeHandleProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  edge: 'in' | 'out';
  keyboardReachable?: boolean;
  /** Fade boundary in pixels from the rendered clip's left edge. */
  boundaryX: number;
  oppositeBoundaryX: number;
  clipWidth: number;
}

/** Upstream 2d007878's quick-fade handle; the host owns the frame-based gesture. */
export function TrackFadeHandle({ edge, keyboardReachable = false, boundaryX,
  oppositeBoundaryX, clipWidth, className, style, ...buttonProps
}: TrackFadeHandleProps): React.ReactElement | null {
  if (clipWidth < 66 && !keyboardReachable) return null;
  const { left, width, glyphLeft } = trackFadeHandleGeometry(edge, boundaryX, oppositeBoundaryX, clipWidth);
  return <button {...buttonProps} type="button" role="slider" data-fade-handle={edge}
    className={className ? `audacity-track-fade-handle ${className}` : 'audacity-track-fade-handle'}
    style={{ ...style, left, width }}>
    <span className="audacity-track-fade-handle__glyph" style={{ left: glyphLeft }}>
      <TrackFadeHandleGlyph edge={edge} />
    </span>
  </button>;
}

/** The upstream rounded black body, white halo and white curve, unchanged. */
export function TrackFadeHandleGlyph({ edge = 'in' }: { edge?: 'in' | 'out' }): React.ReactElement {
  const clipId = React.useId();
  return <svg width="36" height="32" viewBox="0 0 36 32" fill="none" xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true" style={{ display: 'block', overflow: 'visible', ...(edge === 'out' ? { transform: 'scaleX(-1)' } : {}) }}>
    <defs><clipPath id={clipId}><rect x="13" y="11" width="10" height="10" rx="2.5" /></clipPath></defs>
    <rect data-fade-glyph-halo x="12.5" y="10.5" width="11" height="11" rx="3" fill="none" stroke="#FFFFFF" />
    <rect data-fade-glyph-frame x="13" y="11" width="10" height="10" rx="2.5" fill="#000000" />
    <path data-fade-glyph-curve d="M23 11C19.666666666666668 11 13 17.666666666666668 13 21"
      stroke="#FFFFFF" strokeWidth="1.5" clipPath={`url(#${clipId})`} />
  </svg>;
}
