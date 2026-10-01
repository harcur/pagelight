// Folded-paper background: irregular low-poly facets in paper tones.

export function mountFacets() {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.id = 'facets';
  el.setAttribute('aria-hidden', 'true');
  document.body.prepend(el);
  let w = 0, hgt = 0;
  const draw = () => {
    const W = window.innerWidth, H = window.innerHeight;
    if (Math.abs(W - w) < 40 && Math.abs(H - hgt) < 40) return;
    w = W;
    hgt = H;
    el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let s = 5 * 7919;
    const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const step = 96, nx = Math.ceil(W / step) + 1, ny = Math.ceil(H / step) + 1;
    const P: [number, number][][] = [];
    for (let j = 0; j <= ny; j++) {
      const row: [number, number][] = [];
      for (let i = 0; i <= nx; i++) row.push([i * step + (r() - 0.5) * step * 0.9, j * step + (r() - 0.5) * step * 0.9]);
      P.push(row);
    }
    const tones = ['#F3EEE4', '#F0EADF', '#F5F1E9', '#EEE7DB', '#F4EFE6'];
    let out = '';
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
      const t2 = r() > 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      for (const t of t2) out += `<polygon points="${t.map((p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`).join(' ')}" fill="${tones[Math.floor(r() * tones.length)]}" stroke="#E8E1D4" stroke-width="0.6"/>`;
    }
    el.innerHTML = out;
  };
  draw();
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = window.setTimeout(draw, 200);
  });
}
