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

/** Starts the camera in `video` and calls `onText` once with the first QR text found. */
export async function startCamera(video: HTMLVideoElement, onText: (t: string) => void, onError: (e: Error) => void): Promise<CameraScan> {
  let stopped = false;
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (e) {
    onError(e as Error);
    return { stop() {} };
  }
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  await video.play();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const tick = () => {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code?.data) {
        stop();
        onText(code.data);
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  requestAnimationFrame(tick);
  return { stop };
}
