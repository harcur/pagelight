import { camera } from '../../app/camera';
import { capture } from '../../app/process';
import { store } from '../../app/store';
import { h, icons, svg, toast } from '../dom';
import { eye } from '../eye';
import { drawOverlay, startLive, videoRect } from '../live';

/** Manual size mode, set from the size screen; null = use the calibration sheet. */
export const manualMode: { size: [number, number] | null } = { size: null };

export function captureScreen(root: HTMLElement) {
  const overlay = h('canvas', { class: 'overlay' });
  const veil = h('div', { class: 'veil' });
  const status = h('div', { class: 'status italic tr', role: 'status' }, 'Starting camera…');
  const info = h('div', { class: 'pill-dark bl', style: 'display:none' });
  const msg = h('div', { class: 'camera-msg', style: 'display:none' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' }) as HTMLInputElement;
  const vf = h('div', { class: 'viewfinder' }, camera.video, overlay, veil, msg,
    h('div', { class: 'tl', style: 'display:flex;gap:8px' },
      h('a', { class: 'roundbtn', href: '#/', 'aria-label': 'Setup' }, svg(icons.settings)),
      h('button', { class: 'roundbtn', type: 'button', 'aria-label': 'Import photos', onclick: () => fileInput.click() }, svg(icons.photo))),
    status, info);

  const shutterEye = eye(120, 'search');
  const shutter = h('button', { class: 'shutter', type: 'button', 'aria-label': 'Capture page' }, shutterEye) as HTMLButtonElement;
  const count = h('span', { class: 'count' });
  const s1 = h('span', { class: 's1' }), s2 = h('span', { class: 's2' });
  const tray = h('button', { class: 'tray', type: 'button', 'aria-label': 'Review batch', onclick: () => (location.hash = '#/batch') }, s1, s2, count);
  const bgnote = h('div', { class: 'bgnote', role: 'status' });
  const modeChip = h('div', { style: 'display:flex;justify-content:center;min-height:0' });

  root.append(h('main', { class: 'screen', style: 'padding-top:14px' },
    vf,
    modeChip,
    bgnote,
    h('div', { class: 'controls' },
      tray,
      shutter,
      h('a', { class: 'side-action', href: '#/size', style: 'text-decoration:none' }, svg(icons.size), 'Size')),
    fileInput));

  const renderMode = () => {
    modeChip.replaceChildren();
    if (manualMode.size) {
      const [w, hh] = manualMode.size;
      modeChip.append(h('div', { class: 'status', style: 'margin-top:10px' }, `Page size ${w} × ${hh} mm, no sheet`,
        h('button', { class: 'linkbtn', style: 'min-height:28px', onclick: () => { manualMode.size = null; renderMode(); } }, 'Use sheet')));
    }
  };
  renderMode();

  const renderTray = () => {
    const pages = store.pages;
    count.textContent = String(pages.length);
    count.style.display = pages.length ? '' : 'none';
    tray.style.visibility = pages.length ? 'visible' : 'hidden';
    const last = pages[pages.length - 1], prev = pages[pages.length - 2];
    s2.style.backgroundImage = last?.thumb ? `url(${last.thumb})` : '';
    s1.style.backgroundImage = prev?.thumb ? `url(${prev.thumb})` : '';
    const busy = pages.filter((p) => p.status === 'processing');
    const failed = pages.filter((p) => p.status === 'error');
    bgnote.replaceChildren();
    if (busy.length) {
      const p = busy[0];
      const n = pages.indexOf(p) + 1;
      bgnote.append(svg(icons.poly), `Processing page ${n}${busy.length > 1 ? ` (+${busy.length - 1} waiting)` : ''} · ${Math.round(p.progress * 100)}%`);
    } else if (failed.length) {
      bgnote.append(`Page ${pages.indexOf(failed[failed.length - 1]) + 1}: ${failed[failed.length - 1].error}`);
    }
  };
  renderTray();
  const unsub = store.subscribe(renderTray);

  let sheetCorners = 0;
  const onLive = (r: Parameters<typeof drawOverlay>[1]) => {
    drawOverlay(overlay, r, { quad: !!manualMode.size });
    if (!r) return;
    sheetCorners = r.ids.length;
    if (manualMode.size) {
      status.textContent = r.quad ? 'Page detected' : 'Looking for the page';
      shutterEye.setState(r.quad ? 'locked' : 'search');
    } else {
      status.textContent = sheetCorners >= 20 ? 'Sheet detected' : sheetCorners > 0 ? 'Sheet partly visible' : 'Looking for the sheet';
      shutterEye.setState(sheetCorners >= 20 ? 'locked' : 'search');
    }
    info.style.display = '';
    info.textContent = `${sheetCorners} sheet corners · ${camera.width}×${camera.height}`;
  };
  const stopLive = startLive({ onResult: onLive, findQuad: () => !!manualMode.size });

  const fly = () => {
    const r = vf.getBoundingClientRect();
    const t = tray.getBoundingClientRect();
    const f = h('div', { class: 'flyer', style: `left:${r.left + r.width * 0.2}px;top:${r.top + r.height * 0.15}px;width:${r.width * 0.6}px;height:${r.height * 0.7}px` });
    document.body.append(f);
    requestAnimationFrame(() => {
      const sx = 42 / (r.width * 0.6), sy = 56 / (r.height * 0.7);
      f.style.transformOrigin = '0 0';
      f.style.transform = `translate(${t.left + 4 - (r.left + r.width * 0.2)}px, ${t.top + 4 - (r.top + r.height * 0.15)}px) scale(${sx}, ${sy}) rotate(-3deg)`;
      f.style.opacity = '0.8';
      f.style.borderRadius = '40px';
    });
    setTimeout(() => f.remove(), 700);
  };

  shutter.addEventListener('click', async () => {
    if (!camera.active) return fileInput.click();
    shutterEye.setState('capture');
    veil.classList.remove('go');
    void veil.offsetWidth;
    veil.classList.add('go');
    try {
      const bmp = await camera.grab();
      capture({ bitmap: bmp, width: bmp.width, height: bmp.height, manual: manualMode.size ? { widthMm: manualMode.size[0], heightMm: manualMode.size[1] } : undefined });
      setTimeout(fly, 250);
    } catch {
      toast('Could not read the camera frame');
    }
    setTimeout(() => shutterEye.setState(sheetCorners >= 20 ? 'locked' : 'search'), 850);
  });

  fileInput.addEventListener('change', async () => {
    for (const f of Array.from(fileInput.files ?? [])) {
      try {
        const bmp = await createImageBitmap(f);
        const { width, height } = bmp;
        bmp.close();
        capture({ file: f, width, height, manual: manualMode.size ? { widthMm: manualMode.size[0], heightMm: manualMode.size[1] } : undefined });
      } catch {
        toast(`Could not open ${f.name}`);
      }
    }
    fileInput.value = '';
  });

  const onResize = () => drawOverlay(overlay, null);
  window.addEventListener('resize', onResize);

  (async () => {
    try {
      if (!camera.active) await camera.start();
      store.cameraKey = camera.key();
      store.cameraLabel = camera.label();
      if (!store.profile()) {
        info.style.display = '';
        info.textContent = 'Lens not calibrated for this camera — measurements use an estimate';
      }
      status.textContent = 'Looking for the sheet';
      void videoRect;
    } catch (e) {
      msg.style.display = '';
      msg.replaceChildren(
        h('div', { class: 'display', style: 'font-size:22px' }, 'No camera available'),
        h('div', { style: 'opacity:0.85;font-size:14px;max-width:300px' }, e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission was refused. You can still import photos.' : 'You can still import photos taken with another camera.'),
        h('button', { class: 'btn primary small', onclick: () => fileInput.click() }, 'Import photos'));
      status.textContent = 'Import mode';
      shutterEye.setState('idle');
    }
  })();

  return () => {
    stopLive();
    unsub();
    window.removeEventListener('resize', onResize);
    // Keep the stream alive when going to review/size (fast return), stop it otherwise.
    const next = location.hash;
    if (!/^#\/(size|review|batch)/.test(next)) camera.stop();
  };
}
