// Deteksi wajah (MediaPipe FaceDetector, BlazeFace short-range).
import { createTask } from "./visionLib.js";
import { labelText, strokeBox } from "./draw.js";

export function createFaceDetector() {
  let task = null;
  return {
    id: "faces",
    async load(vision, quality) {
      task = await createTask(vision.lib.FaceDetector, vision, "faces", {}, ["CPU"]);
      this.applyQuality(quality);
    },
    applyQuality(q) {
      try { task?.setOptions({ minDetectionConfidence: q.score.faces }); } catch { /* abaikan */ }
    },
    /** @returns {{x,y,w,h,score}[]} koordinat piksel video */
    detect(video, ts) {
      const res = task.detectForVideo(video, ts);
      return (res.detections || []).map((d) => ({
        x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height,
        score: d.categories?.[0]?.score ?? 0,
      }));
    },
    draw(ctx, faces) {
      ctx.save();
      ctx.font = "14px monospace";
      ctx.fillStyle = "#3dffb5";
      faces.forEach((f, i) => {
        strokeBox(ctx, f, "#3dffb5");
        labelText(ctx, `FACE ${i + 1}`, f.x + f.w, f.y - 6);
      });
      ctx.restore();
    },
    close() { task?.close(); task = null; },
  };
}
