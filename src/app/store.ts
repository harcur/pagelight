// App state. Settings and calibration live in localStorage; nothing is ever sent anywhere.
import type { Intrinsics } from '../core/camera';
import type { Calibration } from '../core/calibrate';
import { type CleanOptions, DEFAULT_CLEAN } from '../core/cleanup';
import { type SheetSpec, presetSpec } from '../core/sheet';
import type { PageGeometry } from '../worker/protocol';

export const APP_URL = 'github.com/harcur/pagelight';
export const REPO_URL = 'https://github.com/harcur/pagelight';

export interface CameraProfile {
  key: string;
  label: string;
  calibration: Calibration;
}

export interface SheetChoice {
  preset: string;
  landscape: boolean;
  /** measured / nominal pattern width */
  printScale: number;
  scaleChecked: boolean;
}

export interface Settings {
  sheet: SheetChoice;
  clean: Omit<CleanOptions, 'ppm'>;
  exportPdf: boolean;
  exportPng: boolean;
  lastManualSize: [number, number];
}

export interface Page {
  id: string;
  photo: Blob;
  status: 'processing' | 'ready' | 'error';
  progress: number;
  note?: string;
  error?: string;
  geometry?: PageGeometry;
  clean: Omit<CleanOptions, 'ppm'>;
  thumb?: string;
}

const KEY_SETTINGS = 'pagelight.settings.v1';
const KEY_PROFILES = 'pagelight.profiles.v1';

const defaults: Settings = {
  sheet: { preset: 'A4', landscape: false, printScale: 1, scaleChecked: false },
  clean: { ...DEFAULT_CLEAN },
  exportPdf: true,
  exportPng: false,
  lastManualSize: [297, 420],
};

function read<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? { ...fallback, ...JSON.parse(s) } : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app still works for this session */
  }
}

type Listener = () => void;

class Store {
  settings: Settings = read(KEY_SETTINGS, defaults);
  profiles: Record<string, CameraProfile> = read(KEY_PROFILES, {});
  pages: Page[] = [];
  /** Currently active camera profile key (device + resolution). */
  cameraKey = '';
  cameraLabel = '';
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const l of this.listeners) l();
  }

  saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    write(KEY_SETTINGS, this.settings);
    this.emit();
  }

  sheetSpec(): SheetSpec {
    const s = this.settings.sheet;
    return presetSpec(s.preset, s.landscape, s.printScale);
  }

  profile(): CameraProfile | undefined {
    return this.profiles[this.cameraKey];
  }

  intrinsics(width: number, height: number): Intrinsics | null {
    const p = this.profile();
    return p ? p.calibration.intrinsics : this.anyProfileFor(width, height)?.calibration.intrinsics ?? null;
  }

  /** A profile for a matching resolution, e.g. when a photo is imported from a file. */
  anyProfileFor(width: number, height: number): CameraProfile | undefined {
    return Object.values(this.profiles).find((p) => {
      const k = p.calibration.intrinsics;
      return Math.abs(k.width / k.height - width / height) < 0.01;
    });
  }

  saveProfile(p: CameraProfile) {
    this.profiles = { ...this.profiles, [p.key]: p };
    write(KEY_PROFILES, this.profiles);
    this.emit();
  }

  exportProfiles(): string {
    return JSON.stringify({ app: 'pagelight', version: 1, exported: new Date().toISOString(), profiles: this.profiles, sheet: this.settings.sheet }, null, 2);
  }

  importProfiles(text: string): number {
    const data = JSON.parse(text);
    if (data?.app !== 'pagelight' || typeof data.profiles !== 'object') throw new Error('Not a Pagelight profile file');
    let n = 0;
    for (const [k, p] of Object.entries(data.profiles as Record<string, CameraProfile>)) {
      if (p?.calibration?.intrinsics?.fx) {
        this.profiles[k] = p;
        n++;
      }
    }
    write(KEY_PROFILES, this.profiles);
    if (data.sheet?.preset) this.saveSettings({ sheet: data.sheet });
    this.emit();
    return n;
  }

  addPage(p: Page) {
    this.pages = [...this.pages, p];
    this.emit();
  }
  updatePage(id: string, patch: Partial<Page>) {
    this.pages = this.pages.map((p) => (p.id === id ? { ...p, ...patch } : p));
    this.emit();
  }
  removePage(id: string) {
    const p = this.pages.find((x) => x.id === id);
    if (p?.thumb) URL.revokeObjectURL(p.thumb);
    this.pages = this.pages.filter((x) => x.id !== id);
    this.emit();
  }
  page(id: string) {
    return this.pages.find((p) => p.id === id);
  }
}

export const store = new Store();

// Ask the browser not to evict our storage (calibration takes a few minutes to redo).
navigator.storage?.persist?.().catch(() => undefined);
