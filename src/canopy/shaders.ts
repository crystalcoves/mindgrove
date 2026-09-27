/* Holographic materials for the canopy. Colours above 1.0 are intentional:
   they feed the bloom pass. */

export const branchVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aFade;
  varying vec3 vColor;
  varying float vFade;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vView = normalize(-mv.xyz);
    vY = wp.y;
    vColor = aColor;
    vFade = aFade;
    gl_Position = projectionMatrix * mv;
  }
`;

export const branchFragment = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vColor;
  varying float vFade;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.7);
    float scan = 0.78 + 0.22 * sin(vY * 34.0 - uTime * 3.0 * uMotion);
    // Sap: bands of light travelling up the tree.
    float sap = pow(max(0.0, sin(vY * 1.1 - uTime * 1.4 * uMotion)), 14.0);
    vec3 col = vColor * (0.16 + 0.95 * fres) * scan + vColor * sap * 0.55;
    float grey = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(grey) * 0.55, vFade);
    col *= 1.0 - 0.6 * vFade;
    gl_FragColor = vec4(col, 0.45 + 0.55 * fres);
  }
`;

export const sporeVertex = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uSize;
  uniform float uHeight;
  attribute float aSeed;
  varying float vTw;
  void main() {
    vec3 p = position;
    float t = uTime * uMotion;
    p.y = mod(p.y + t * (0.12 + aSeed * 0.25), uHeight) - 0.5;
    p.x += sin(t * 0.3 + aSeed * 40.0) * 0.4;
    p.z += cos(t * 0.27 + aSeed * 23.0) * 0.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = min(uSize * (0.4 + aSeed) * (220.0 / -mv.z), 14.0);
    vTw = 0.45 + 0.55 * sin(t * 1.7 + aSeed * 90.0);
    // Fade out near the ground and the top.
    vTw *= smoothstep(0.0, 1.5, p.y) * (1.0 - smoothstep(uHeight - 3.0, uHeight - 0.5, p.y));
    gl_Position = projectionMatrix * mv;
  }
`;

export const sporeFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * a * vTw * 0.9, a * vTw);
  }
`;

export const groundVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const groundFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uMotion;
  uniform float uRadius;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float a = atan(vP.y, vP.x);
    float rings = smoothstep(0.035, 0.0, abs(fract(r * 0.5) - 0.5) - 0.46);
    float spokes = smoothstep(0.02, 0.0, abs(fract(a / 6.28318 * 24.0) - 0.5) - 0.48) * step(1.2, r);
    float pulse = smoothstep(0.35, 0.0, abs(r - mod(uTime * 1.6 * uMotion, uRadius * 1.4))) * 0.6;
    float core = smoothstep(2.4, 0.0, r) * 0.55;
    float edge = 1.0 - smoothstep(uRadius * 0.55, uRadius, r);
    float v = (rings * 0.35 + spokes * 0.18 + pulse * uMotion + core) * edge;
    gl_FragColor = vec4(uColor * v, v);
  }
`;
