import './ui/styles.css';
import { mountFacets } from './ui/facets';
import { warmUp } from './app/workers';
import { setupScreen } from './ui/screens/setup';
import { sheetScreen } from './ui/screens/sheet';
import { calibrateScreen } from './ui/screens/calibrate';
import { captureScreen } from './ui/screens/capture';
import { sizeScreen } from './ui/screens/size';
import { reviewScreen } from './ui/screens/review';
import { batchScreen } from './ui/screens/batch';

type Screen = (root: HTMLElement, arg?: string) => (() => void) | void;

const routes: Record<string, Screen> = {
  '': setupScreen,
  sheet: sheetScreen,
  calibrate: calibrateScreen,
  capture: captureScreen,
  size: sizeScreen,
  review: reviewScreen,
  batch: batchScreen,
};

const root = document.getElementById('app')!;
let cleanup: (() => void) | void;

function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const screen = routes[name] ?? setupScreen;
  if (cleanup) cleanup();
  root.replaceChildren();
  window.scrollTo(0, 0);
  cleanup = screen(root, arg && decodeURIComponent(arg));
}

export function go(path: string) {
  location.hash = `#/${path}`;
}

mountFacets();
window.addEventListener('hashchange', route);
route();
// OpenCV is large; start loading it while the user is still on the first screen.
warmUp().catch((e) => console.error('OpenCV failed to load', e));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
