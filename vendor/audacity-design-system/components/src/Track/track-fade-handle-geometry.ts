/** Adaptive placement from upstream TrackNew at 2d007878 (2026-10-26).
 * The glyph is 36×32, its body 10×10, and its stationary hit box 30px wide. */
export function trackFadeHandleGeometry(edge: 'in' | 'out', boundaryX: number,
  oppositeBoundaryX: number, clipWidth: number): { left: number; width: number; glyphLeft: number } {
  const incoming = edge === 'in' ? boundaryX : oppositeBoundaryX;
  const outgoing = edge === 'out' ? boundaryX : oppositeBoundaryX;
  const retreat = outgoing - incoming < 60;
  const incomingTarget = preferred('in', incoming, retreat, clipWidth);
  const outgoingTarget = preferred('out', outgoing, retreat, clipWidth);
  if (incomingTarget.left + incomingTarget.width <= outgoingTarget.left
    || outgoingTarget.left + outgoingTarget.width <= incomingTarget.left) {
    return edge === 'in' ? incomingTarget : outgoingTarget;
  }
  // Legacy projects may retain independently overlapping fades. Keep both
  // targets accessible even though upstream's effective fades cannot cross.
  const width = Math.max(1, Math.min(30, (clipWidth - 14) / 2));
  const first = Math.max(6, Math.min(clipWidth - 8 - width * 2,
    (incomingTarget.left + outgoingTarget.left) / 2 - (width + 2) / 2));
  return { left: first + (edge === 'out' ? width + 2 : 0), width, glyphLeft: width / 2 - 18 };
}

function preferred(edge: 'in' | 'out', boundaryX: number, retreat: boolean, clipWidth: number) {
  const inward = edge === 'in' ? !retreat : retreat;
  const rawBodyLeft = inward ? boundaryX + 10 : boundaryX - 20;
  const bodyLeft = Math.round(Math.max(10, Math.min(clipWidth - 20, rawBodyLeft)));
  const centre = bodyLeft + 5;
  const left = Math.max(6, centre - 15);
  const right = Math.min(clipWidth - 6, centre + 15);
  return { left, width: Math.max(1, right - left), glyphLeft: centre - 18 - left };
}
