// Helper gambar untuk canvas overlay. Canvas di-mirror lewat CSS (scaleX(-1)),
// jadi teks harus digambar terbalik agar terbaca normal di layar.

/** Gambar teks yang terbaca normal. x = tepi KANAN kotak (dalam koordinat canvas). */
export function labelText(ctx, text, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function strokeBox(ctx, b, color, dashed = false, width = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}
