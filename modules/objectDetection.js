// Pengenalan objek (MediaPipe ObjectDetector, EfficientDet-Lite0, 80 kelas COCO).
import { createTask } from "./visionLib.js";
import { labelText, strokeBox } from "./draw.js";
import { getLang } from "./i18n.js";

const OBJ_ID = {
  person: "orang", "cell phone": "ponsel", laptop: "laptop", bottle: "botol", cup: "cangkir", chair: "kursi",
  book: "buku", cat: "kucing", dog: "anjing", tv: "TV", keyboard: "keyboard", mouse: "mouse", backpack: "tas ransel",
  handbag: "tas tangan", car: "mobil", motorcycle: "motor", bicycle: "sepeda", couch: "sofa", bed: "kasur",
  clock: "jam", scissors: "gunting", knife: "pisau", remote: "remote", umbrella: "payung", "dining table": "meja makan",
  bird: "burung", banana: "pisang", apple: "apel", orange: "jeruk", bowl: "mangkuk", fork: "garpu", spoon: "sendok",
  vase: "vas", "potted plant": "tanaman", toilet: "toilet", sink: "wastafel", refrigerator: "kulkas", oven: "oven",
  microwave: "microwave", toothbrush: "sikat gigi", "teddy bear": "boneka", suitcase: "koper", bench: "bangku",
};
/** Nama objek sesuai bahasa aktif. Inggris: nama COCO asli, jamak bila count > 1 ("2 people", "3 cups"). */
export const objName = (n, count = 1) => {
  if (getLang() !== "en") return OBJ_ID[n] || n;
  if (count <= 1) return n;
  return n === "person" ? "people" : /(s|sh|ch|x)$/.test(n) ? `${n}es` : `${n}s`;
};

export function createObjectDetector() {
  let task = null;
  return {
    id: "objects",
    async load(vision, quality) {
      task = await createTask(vision.lib.ObjectDetector, vision, "objects", {
        scoreThreshold: quality.score.objects, maxResults: quality.maxObjects,
      }, ["CPU"]);
    },
    applyQuality(q) {
      try { task?.setOptions({ scoreThreshold: q.score.objects, maxResults: q.maxObjects }); } catch { /* abaikan */ }
    },
    /** @returns {{name,score,box:{x,y,w,h}}[]} */
    detect(video, ts) {
      const res = task.detectForVideo(video, ts);
      return (res.detections || []).map((d) => ({
        name: d.categories[0].categoryName,
        score: d.categories[0].score,
        box: { x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height },
      }));
    },
    draw(ctx, objects) {
      ctx.save();
      ctx.font = "13px monospace";
      for (const o of objects) {
        const person = o.name === "person";
        const color = person ? "#3dffb5" : "#00e5ff";
        ctx.fillStyle = color;
        strokeBox(ctx, o.box, color, !person);
        labelText(ctx, `${objName(o.name).toUpperCase()} ${Math.round(o.score * 100)}%`, o.box.x + o.box.w, o.box.y + o.box.h + 14);
      }
      ctx.restore();
    },
    close() { task?.close(); task = null; },
  };
}
