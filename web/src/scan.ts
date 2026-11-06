import jsQR from "jsqr";

/** Decodes a QR code from an image file. Returns the text or undefined. */
export async function decodeImageFile(file: File): Promise<string | undefined> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(data.data, data.width, data.height)?.data;
}

export interface CameraScan {
  stop(): void;
}

/** How a frame is read: the browser's own detector where there is one (it copes with dense codes), else jsQR on several views of the frame. */
type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
function nativeDetector(): Detector | undefined {
  const BD = (globalThis as any).BarcodeDetector;
  try { return BD ? new BD({ formats: ["qr_code"] }) : undefined; } catch { return undefined; }
}

/** Reads one frame with jsQR: the whole frame, then a centred crop enlarged (a long invoice QR needs every pixel), then mirrored. */
function readFrame(frame: HTMLCanvasElement, work: HTMLCanvasElement, n: number): string | undefined {
  const g = frame.getContext("2d", { willReadFrequently: true })!;
  const whole = g.getImageData(0, 0, frame.width, frame.height);
  const direct = jsQR(whole.data, whole.width, whole.height, { inversionAttempts: "dontInvert" })?.data;
  if (direct) return direct;
  const side = Math.round(Math.min(frame.width, frame.height) * 0.85);
  const sx = Math.round((frame.width - side) / 2), sy = Math.round((frame.height - side) / 2);
  const wg = work.getContext("2d", { willReadFrequently: true })!;
  const scale = 2;
  work.width = side * scale; work.height = side * scale;
  wg.imageSmoothingEnabled = true; wg.imageSmoothingQuality = "high";
  wg.drawImage(frame, sx, sy, side, side, 0, 0, work.width, work.height);
  const crop = wg.getImageData(0, 0, work.width, work.height);
  const cropped = jsQR(crop.data, crop.width, crop.height, { inversionAttempts: "dontInvert" })?.data;
  if (cropped) return cropped;
  if (n % 2 === 0) { // a mirrored view, on every other frame to keep the page responsive
    wg.save(); wg.translate(work.width, 0); wg.scale(-1, 1);
    wg.drawImage(frame, sx, sy, side, side, 0, 0, work.width, work.height);
    wg.restore();
    const flip = wg.getImageData(0, 0, work.width, work.height);
    return jsQR(flip.data, flip.width, flip.height, { inversionAttempts: "dontInvert" })?.data;
  }
  return undefined;
}

export interface CameraHooks {
  /** Called once with the first QR text found. */
  onText: (t: string) => void;
  onError: (e: Error) => void;
  /** Plain-language progress for the visitor: what is being looked for, and what to try if it takes a while. */
  onStatus: (note: string) => void;
}

/** Starts the camera in `video` and scans every frame until a QR is found. */
export async function startCamera(video: HTMLVideoElement, hooks: CameraHooks): Promise<CameraScan | undefined> {
  let stopped = false;
  let stream: MediaStream | undefined;
  try {
    // ask for the sharpest picture the camera has: a long invoice QR is dense, and a 640 px picture cannot hold it
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    hooks.onError(e as Error);
    return undefined; // nothing is running, so the caller must not look as if it is
  }
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  await video.play();
  const frame = document.createElement("canvas");
  const work = document.createElement("canvas");
  const fctx = frame.getContext("2d", { willReadFrequently: true })!;
  const native = nativeDetector();
  const started = Date.now();
  let n = 0;
  let busy = false;
  let hint = "";
  const say = (note: string) => { if (note !== hint) { hint = note; hooks.onStatus(note); } };
  say("Looking for a QR code. Hold it steady and let it fill most of the picture.");
  const found = (text: string) => {
    stop();
    hooks.onStatus("QR code found. Checking the signature…");
    hooks.onText(text);
  };
  const tick = async () => {
    if (stopped) return;
    if (!busy && video.readyState === video.HAVE_ENOUGH_DATA) {
      busy = true;
      try {
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        fctx.drawImage(video, 0, 0);
        let text: string | undefined;
        if (native) text = (await native.detect(frame).catch(() => []))[0]?.rawValue;
        if (!text) text = readFrame(frame, work, n++);
        if (text) return found(text);
      } finally { busy = false; }
      const secs = (Date.now() - started) / 1000;
      if (secs > 6) {
        const low = video.videoWidth < 1000 ? ` This camera is ${video.videoWidth} px wide, so a long code needs to be large and sharp.` : "";
        say(`Still looking. Move closer or hold the code steadier, make sure it is well lit and flat.${low}`);
      }
    }
    if (!stopped) requestAnimationFrame(() => void tick());
  };
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  void tick();
  return { stop };
}
