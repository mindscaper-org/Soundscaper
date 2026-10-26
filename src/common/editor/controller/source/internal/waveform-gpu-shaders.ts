/* SPDX-License-Identifier: AGPL-3.0-only */
export const waveformVertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec4 span;
layout(location=1) in vec3 rmsAndX;
uniform vec2 viewport;
uniform bool backgroundOnly;
flat out vec4 bands;
flat out float columnX;
void main() {
  float x = (gl_VertexID == 0 || gl_VertexID == 2) ? span.x : span.y;
  float y = gl_VertexID < 2 ? floor(span.z) : ceil(span.w);
  if (backgroundOnly) {
    x = (gl_VertexID == 0 || gl_VertexID == 2) ? 0.0 : viewport.x;
    y = gl_VertexID < 2 ? 0.0 : viewport.y;
  }
  gl_Position = vec4(vec2(x, y) / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  bands = vec4(span.zw, rmsAndX.xy);
  columnX = rmsAndX.z;
}`;

export const waveformFragmentShader = `#version 300 es
precision highp float;
uniform vec2 viewport;
uniform vec2 selection;
uniform vec2 selectionPixels;
uniform bool backgroundOnly;
uniform vec4 backgroundColor;
uniform vec4 sampleColor;
uniform vec4 selectedSampleColor;
uniform vec4 rmsColor;
uniform vec4 selectedRmsColor;
flat in vec4 bands;
flat in float columnX;
out vec4 color;
float coverage(vec2 span, float y) {
  return clamp(min(span.y, y + 0.5) - max(span.x, y - 0.5), 0.0, 1.0);
}
void main() {
  if (backgroundOnly) {
    float coverageX = coverage(selectionPixels, gl_FragCoord.x);
    float alpha = backgroundColor.a * coverageX;
    color = vec4(backgroundColor.rgb * alpha, alpha);
    return;
  }
  float y = viewport.y - gl_FragCoord.y;
  bool selected = columnX >= selection.x && columnX < selection.y;
  vec4 peak = selected ? selectedSampleColor : sampleColor;
  vec4 rms = selected ? selectedRmsColor : rmsColor;
  peak.a *= coverage(bands.xy, y);
  rms.a *= coverage(bands.zw, y);
  color = vec4(rms.rgb * rms.a, rms.a) + vec4(peak.rgb * peak.a, peak.a) * (1.0 - rms.a);
}`;
