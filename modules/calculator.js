// Smart Calculator: parser bahasa Indonesia (angka/kata/simbol) + evaluator aman (TANPA eval).
// Murni & bisa diuji di Node. Dipakai oleh perintah suara/teks (commands.js) dan tombol HUD (script.js).
//
// Contoh yang dipahami:
//   "hitung 125 dikali 8"            → 1000
//   "berapa seratus dua puluh lima ditambah 5 juta"
//   "15 persen dari 200"  /  "100 ditambah 10 persen" (=110)
//   "akar dari 144"  /  "5 kuadrat"  /  "2 pangkat 10"  /  "(2 + 3) × 4"  /  "17 modulo 5"

import { t, getLang, meta } from "./i18n.js";

const WAKE = /^(?:(?:hei|hey|hai|halo|hi|hello|ok|oke|okay)\s+)*(?:j[ae]rvis|[yhg]arvis|a?e[gj]is|ijis)\b/;
// kata pembuka perintah (Indonesia & Inggris); "strong" = jelas kalkulasi, "berapa/what is" = lemah (bisa pertanyaan lain)
const LEAD = /^(?:(?:tolong|coba|bisa|bisakah|kamu|anda|dong|ya|please|can you|could you|just)\s+)*(hitung(?:kan|lah)?|kalkulasi(?:kan)?|kalkulator|selesaikan|berapa(?:kah)?|hasil(?:nya)?|calculate|compute|calc|solve|work out|what(?:'s| is|s)|how much is|how much)\b(?:\s+(?:hasil(?:nya)?|dari|ya|is|the|result|of))*\s*/;
const STRONG = /^(hitung|kalkulasi|kalkulator|selesaikan|calculate|compute|calc|solve|work out)/;

const T = (o) => Object.assign(Object.create(null), o); // tanpa prototype: "constructor" bukan kata bilangan
const UNIT = T({
  nol: 0, kosong: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
});
const SPECIAL = T({
  sepuluh: 10, sebelas: 11, seratus: 100,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
});
const BIG = T({
  ribu: 1e3, juta: 1e6, miliar: 1e9, milyar: 1e9, triliun: 1e12,
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
});
const SMALL_MULT = new Set(["belas", "puluh", "ratus", "hundred"]);
const SE_BIG = T({ seribu: 1e3, sejuta: 1e6, semiliar: 1e9, semilyar: 1e9, setriliun: 1e12 });
const isNumWord = (w) => w in UNIT || w in SPECIAL || w in BIG || w in SE_BIG || SMALL_MULT.has(w);

const OPS = T({
  tambah: "+", ditambah: "+", tambahkan: "+", plus: "+",
  kurang: "-", dikurangi: "-", kurangi: "-", minus: "-",
  kali: "*", dikali: "*", dikalikan: "*", kalikan: "*", x: "*",
  bagi: "/", dibagi: "/", dibagikan: "/",
  pangkat: "^", dipangkatkan: "^",
  mod: "mod", modulo: "mod",
  times: "*", multiplied: "*", divided: "/", power: "^", negative: "-",
});
const SYMBOLS = T({ "+": "+", "-": "-", "−": "-", "–": "-", "*": "*", "×": "*", "/": "/", "÷": "/", "^": "^" });
const FILLER = new Set(["sir", "ya", "dong", "deh", "tolong", "hasil", "hasilnya", "adalah", "sama", "dengan", "berapa", "bapak", "pak", "kak", "nya", "jarvis", "aegis",
  "a", "an", "the", "is", "to", "by", "equals", "equal", "raised", "please", "what", "whats", "much", "and"]);

class CalcError extends Error {}

/**
 * Indonesia: "1.000,5" → 1000.5 ; "3,5" → 3.5 ; "3.5" → 3.5.
 * Inggris:   "1,000.5" → 1000.5 ; "3.5" → 3.5.  Selain itu NaN.
 */
export function parseNum(s, lg = getLang()) {
  if (lg === "en") {
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d+(,\d+)?$/.test(s)) return Number(s.replace(",", "."));
  if (/^\d+\.\d+$/.test(s)) return Number(s);
  return NaN;
}

/** Gabungkan deretan kata bilangan ("seratus dua puluh lima", "dua ribu lima ratus") menjadi angka. */
function readNumberWords(raw, i) {
  let total = 0, grp = 0, pend = null, j = i, any = false;
  for (; j < raw.length; j++) {
    const w = raw[j];
    if (w === "and" && any && isNumWord(raw[j + 1])) continue; // "one hundred and five"
    if (!isNumWord(w)) break;
    any = true;
    if (w in UNIT) pend = UNIT[w];
    else if (w in SPECIAL) grp += SPECIAL[w];
    else if (w in SE_BIG) total += SE_BIG[w];
    else if (w === "belas") { grp += (pend ?? 0) + 10; pend = null; }
    else if (w === "puluh") { grp += (pend ?? 1) * 10; pend = null; }
    else if (w === "ratus" || w === "hundred") { grp += (pend ?? 1) * 100; pend = null; }
    else { const v = grp + (pend ?? 0) || 1; total += v * BIG[w]; grp = 0; pend = null; }
  }
  let value = total + grp + (pend ?? 0);
  // "koma"/"point": "tiga koma lima", "three point five" → 3,5
  if (any && (raw[j] === "koma" || raw[j] === "point") && (raw[j + 1] in UNIT || /^\d$/.test(raw[j + 1] || ""))) {
    j++;
    let dec = "";
    while (j < raw.length && (raw[j] in UNIT || /^\d$/.test(raw[j]))) dec += raw[j] in UNIT ? UNIT[raw[j]] : raw[j], j++;
    value = Number(`${value}.${dec}`);
  }
  return { value, next: j };
}

const RE = /\d+(?:[.,]\d+)*|[a-z]+|[-+*/^%()×÷−–]/g;

/** Teks → daftar token. Mengembalikan {tokens, unknown}. */
function lex(s) {
  const raw = s.replace(/√/g, " akar ").match(RE) || [];
  const out = [];
  const last = () => out[out.length - 1];
  let unknown = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (/^\d/.test(w)) {
      const v = parseNum(w);
      if (Number.isNaN(v)) { unknown++; continue; }
      out.push({ k: "num", v, digits: true });
    } else if (w in BIG && last()?.k === "num" && last().digits) {
      last().v *= BIG[w]; // "5 juta"
    } else if (isNumWord(w)) {
      const { value, next } = readNumberWords(raw, i);
      out.push({ k: "num", v: value });
      i = next - 1;
    } else if (w in SYMBOLS) out.push({ k: "op", v: SYMBOLS[w] });
    else if (w in OPS) out.push({ k: "op", v: OPS[w] });
    else if (w === "%" || w === "persen") out.push({ k: "pct" });
    else if (w === "(") out.push({ k: "(" });
    else if (w === ")") out.push({ k: ")" });
    else if (w === "kurung") {
      const nx = raw[i + 1];
      if (nx === "buka") { out.push({ k: "(" }); i++; } else if (nx === "tutup") { out.push({ k: ")" }); i++; } else unknown++;
    } else if (w === "akar") { out.push({ k: "fn", v: "sqrt" }); if (raw[i + 1] === "kuadrat") i++; }
    else if (w === "square" && raw[i + 1] === "root") { out.push({ k: "fn", v: "sqrt" }); i++; }
    else if (w === "kuadrat" || w === "squared" || w === "square") out.push({ k: "fn", v: "sq" });
    else if (w === "kubik" || w === "cubed" || w === "cube") out.push({ k: "fn", v: "cube" });
    else if (w === "dari" || w === "of") { if (last()?.k === "pct") out.push({ k: "op", v: "*" }); }
    else if (w === "percent") out.push({ k: "pct" });
    else if (FILLER.has(w)) { /* abaikan */ }
    else unknown++;
  }
  return { tokens: out, unknown };
}

/** Evaluator recursive-descent. Persen: "100 + 10%" = 110, "10% dari 200" = 20. */
function evaluate(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (t, ...v) => t && t.k === "op" && v.includes(t.v);
  const bad = () => { throw new SyntaxError("parse"); };

  function expr() {
    let l = term();
    while (isOp(peek(), "+", "-")) {
      const op = tokens[p++].v;
      const r = term();
      const rv = r.pct ? l.v * r.v : r.v;
      l = { v: op === "+" ? l.v + rv : l.v - rv };
    }
    return l;
  }
  function term() {
    let l = unary();
    while (isOp(peek(), "*", "/", "mod")) {
      const op = tokens[p++].v;
      const r = unary();
      if ((op === "/" || op === "mod") && r.v === 0) throw new CalcError("div0");
      l = { v: op === "*" ? l.v * r.v : op === "/" ? l.v / r.v : l.v % r.v };
    }
    return l;
  }
  function unary() {
    if (isOp(peek(), "+", "-")) {
      const s = tokens[p++].v === "-" ? -1 : 1;
      return { v: s * unary().v };
    }
    return power();
  }
  function power() {
    const b = postfix();
    if (isOp(peek(), "^")) { p++; return { v: b.v ** unary().v }; }
    return b;
  }
  function postfix() {
    let n = primary();
    for (;;) {
      const t = peek();
      if (t?.k === "pct") { p++; n = { v: n.v / 100, pct: true }; }
      else if (t?.k === "fn" && t.v !== "sqrt") { p++; n = { v: n.v ** (t.v === "sq" ? 2 : 3) }; }
      else return n;
    }
  }
  function primary() {
    const t = tokens[p++];
    if (!t) bad();
    if (t.k === "num") return { v: t.v };
    if (t.k === "(") {
      const e = expr();
      if (peek()?.k === ")") p++; else if (p < tokens.length) bad();
      return { v: e.v };
    }
    if (t.k === "fn") {
      const a = (isOp(peek(), "+", "-") ? unary() : primary()).v;
      if (t.v === "sqrt") { if (a < 0) throw new CalcError("negsqrt"); return { v: Math.sqrt(a) }; }
      return { v: a ** (t.v === "sq" ? 2 : 3) };
    }
    return bad();
  }

  const r = expr();
  if (p !== tokens.length) bad();
  return r.v;
}

// ---------------------------------------------------------------- tampilan
/** Angka untuk layar: pemisah ribuan/desimal mengikuti bahasa aktif ("1.000,5" id · "1,000.5" en). */
export const fmtDisplay = (n) => n.toLocaleString(meta().locale, { maximumFractionDigits: 10 });
/** Angka untuk TTS: tanpa pemisah ribuan; desimal diucapkan ("koma" / "point"). */
const fmtSay = (n) => n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 })
  .replace("-", `${t("w.neg")} `).replace(".", t("w.point"));

const SIGNS = { "+": "+", "-": "−", "*": "×", "/": "÷", "^": "^", mod: " mod " };

/** mode: "sym" (125 × 8) | "text" (125 dikali 8, angka berformat) | "say" (untuk TTS, angka polos) */
function render(tokens, mode) {
  const operandEnd = (k) => k && (k.k === "num" || k.k === ")" || k.k === "pct" || (k.k === "fn" && k.v !== "sqrt"));
  const parts = [];
  tokens.forEach((tk, i) => {
    const prev = tokens[i - 1];
    const num = mode === "say" ? fmtSay : fmtDisplay;
    if (tk.k === "num") parts.push(num(tk.v));
    else if (tk.k === "op") {
      const unary = (tk.v === "-" || tk.v === "+") && !operandEnd(prev);
      if (mode === "sym") parts.push(unary ? SIGNS[tk.v] : ` ${SIGNS[tk.v].trim()} `);
      else if (unary) parts.push(tk.v === "-" ? t("w.neg") : "");
      else parts.push(tk.v === "*" && prev?.k === "pct" ? t("w.of") : t(`w.${tk.v}`));
    } else if (tk.k === "pct") parts.push(mode === "sym" ? "%" : t("w.pct"));
    else if (tk.k === "fn") {
      parts.push(mode === "sym" ? { sqrt: "√", sq: "²", cube: "³" }[tk.v] : t(`w.${tk.v}`));
    } else parts.push(tk.k); // kurung
  });
  return mode === "sym" ? parts.join("").trim() : parts.filter(Boolean).join(" ").replace(/\( /g, "(").replace(/ \)/g, ")");
}

// ---------------------------------------------------------------- API
/**
 * @param {string} input teks/suara mentah
 * @param {{force?:boolean}} [opt] force=true (tombol "=") → selalu diperlakukan sebagai perintah hitung
 * @returns {null | {text:string, speech?:string, calc?:{expr:string,result:string,value:number}}}
 *   null = bukan perintah kalkulator (biarkan modul lain menangani).
 */
export function calculate(input, { force = false } = {}) {
  let s = String(input).toLowerCase().trim().replace(WAKE, "").replace(/^[\s,.:;!]+/, "");
  const m = LEAD.exec(s);
  const strong = force || (m && STRONG.test(m[1]));
  if (m) s = s.slice(m[0].length);

  const { tokens, unknown } = lex(s);
  const hasNum = tokens.some((t) => t.k === "num");
  const hasOp = tokens.some((t) => t.k !== "num" && t.k !== "(" && t.k !== ")");
  const fail = { text: t("calc.fail") };
  if (!hasNum || unknown || (!strong && !hasOp)) return strong ? fail : null;

  let value;
  try {
    value = evaluate(tokens);
  } catch (e) {
    if (e instanceof CalcError) {
      return { text: t(e.message === "div0" ? "calc.div0" : "calc.negsqrt") };
    }
    return strong ? fail : null;
  }
  if (!Number.isFinite(value)) return { text: t("calc.big") };
  value = Number(value.toPrecision(12)); // 0.1 + 0.2 → 0.3

  const expr = render(tokens, "sym");
  const result = fmtDisplay(value);
  const simple = tokens.length === 1 || tokens.some((t) => t.k === "(" || t.k === ")");
  const text = simple ? t("calc.result", { r: result }) : t("calc.equals", { e: render(tokens, "text"), r: result });
  const speech = simple ? t("calc.result", { r: fmtSay(value) }) : t("calc.equals", { e: render(tokens, "say"), r: fmtSay(value) });
  return { text, speech, calc: { expr, result, value } };
}

