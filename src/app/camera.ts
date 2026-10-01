// Camera access. Frames are grabbed as ImageBitmaps and handed to the workers.

export class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  get active() {
    return !!this.stream;
  }
  get width() {
    return this.video.videoWidth;
  }
  get height() {
    return this.video.videoHeight;
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    const video: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 4096 }, height: { ideal: 3072 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => undefined);
    if (!this.video.videoWidth) await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
    // Keep focus and exposure steady where the browser allows it; calibration assumes a fixed lens state.
    const track = this.stream.getVideoTracks()[0];
    const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { focusMode?: string[] };
    if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Stable key for the calibration profile: camera identity plus resolution. */
  key(): string {
    const t = this.stream?.getVideoTracks()[0];
    const s = t?.getSettings();
    return `${t?.label || s?.deviceId || 'camera'}@${this.width}x${this.height}`;
  }
  label(): string {
    return this.stream?.getVideoTracks()[0]?.label || 'Camera';
  }

  grab(): Promise<ImageBitmap> {
    return createImageBitmap(this.video);
  }

  grabSmall(maxSide: number): Promise<ImageBitmap> {
    const s = Math.min(1, maxSide / Math.max(this.width, this.height));
    return createImageBitmap(this.video, { resizeWidth: Math.round(this.width * s), resizeHeight: Math.round(this.height * s), resizeQuality: 'medium' });
  }

  static async devices(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }
}

export const camera = new Camera();
