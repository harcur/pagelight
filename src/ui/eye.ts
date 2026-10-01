// The eye: logo, shutter and status indicator. A plain almond eye with a faceted iris.
import { svg } from './dom';

export type EyeState = 'idle' | 'search' | 'locked' | 'capture' | 'process' | 'rest';

const ALMOND = 'M-54 4 C-30 -28 30 -28 54 4 C30 32 -30 32 -54 4 Z';

let uid = 0;
let facetCache: string | null = null;

/** Irregular polygon facets of the iris (deterministic). */
function facets(): string {
  if (facetCache) return facetCache;
  let s = 11;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const n = 7, R = 23, st = (2 * R) / n;
  const P: [number, number][][] = [];
  for (let j = 0; j <= n; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      let x = -R + i * st, y = -R + 3 + j * st;
      if (i > 0 && i < n) x += (r() - 0.5) * st * 0.8;
      if (j > 0 && j < n) y += (r() - 0.5) * st * 0.8;
      row.push([x, y]);
    }
    P.push(row);
  }
  const blues = ['#2F3E6B', '#3B4C7D', '#4A5E92', '#5D71A3', '#7486B3', '#2A3660'];
  const ambers = ['#C9A15B', '#B88A45', '#D9B36E', '#A57A3C'];
  let out = '';
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
    const tris = (i + j) % 2 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
    for (const t of tris) {
      const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3 - 3;
      const dist = Math.hypot(cx, cy);
      if (dist > 25) continue;
      const light = cy < -4 && cx < 4;
      const fill = dist < 11.5 && r() > 0.25 ? ambers[Math.floor(r() * ambers.length)] : blues[Math.min(blues.length - 1, Math.floor(r() * 4) + (light ? 1 : 0))];
      const pts = t.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
      out += `<polygon class="facet" points="${pts}" fill="${fill}" stroke="${fill}" stroke-width="0.3" style="--d:${(dist / 9).toFixed(2)}s;--r:${(dist / 22).toFixed(2)}s"/>`;
    }
  }
  return (facetCache = out);
}

export function eye(size: number, state: EyeState = 'idle', label = ''): HTMLElement & { setState(s: EyeState): void } {
  const id = ++uid;
  const h = Math.round((size * 88) / 120);
  const markup = `<svg viewBox="-60 -44 120 88" width="${size}" height="${h}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>
    <defs>
      <clipPath id="alm${id}"><path d="${ALMOND}"/></clipPath>
      <clipPath id="iri${id}"><circle cx="0" cy="3" r="21"/></clipPath>
    </defs>
    <circle class="halo" cx="0" cy="3" r="24" fill="none" stroke="#D9A441" stroke-width="1.4"/>
    <g class="lid">
      <path d="${ALMOND}" fill="#FBF8F2"/>
      <g clip-path="url(#alm${id})"><g class="iris">
        <g clip-path="url(#iri${id})">${facets()}</g>
        <circle cx="0" cy="3" r="21" fill="none" stroke="#1F1D1A" stroke-width="0.8" opacity="0.6"/>
        <circle cx="0" cy="3" r="7.2" fill="#1F1D1A"/>
        <polygon points="-4.5,-2.5 -1.2,-4.6 0.6,-2.2 -2.6,-0.4" fill="#FBF8F2" opacity="0.92"/>
      </g></g>
      <path d="${ALMOND}" fill="none" stroke="#1F1D1A" stroke-width="1.6" stroke-linejoin="round"/>
    </g>
    <path class="restline" d="M-54 4 C-30 24 30 24 54 4" fill="none" stroke="#1F1D1A" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
  const wrap = document.createElement('span') as HTMLElement & { setState(s: EyeState): void };
  wrap.className = 'eye';
  wrap.style.display = 'inline-block';
  wrap.append(svg(markup));
  wrap.setState = (s: EyeState) => {
    if (wrap.dataset.state === s) return;
    // restart one-shot animations
    if (s === 'capture') {
      wrap.dataset.state = '';
      void wrap.offsetWidth;
    }
    wrap.dataset.state = s;
  };
  wrap.setState(state);
  return wrap;
}
