// Motor de extracción de movimientos bancarios a partir del texto posicionado de un PDF.
// Funciona en navegador y en Node: no depende del DOM.

const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12 };
const MES_RE = "ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|set|oct|nov|dic|dec";
const DATE_RE = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?$/;
const DATE_TXT_RE = new RegExp(`^(\\d{1,2})[\\s\\-\\/.]?(${MES_RE})[a-z]*\\.?(?:[\\s\\-\\/.]?(\\d{2}|\\d{4}))?$`, "i");
const DATE_MDY_RE = new RegExp(`^(${MES_RE})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i");
const AMT_ES = /^([+\-−])?\s*(?:€\s*)?(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})\s*(?:€|eur)?\s*([+\-−])?$/i;
const AMT_EN = /^([+\-−])?\s*(?:€\s*)?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*(?:€|eur)?\s*([+\-−])?$/i;

const HDR = {
  fecha: /^(fecha|f\.?\s*oper(aci[oó]n)?\.?|fecha\s+oper(aci[oó]n)?|f\.?\s*contable|fecha\s+contable|data|date|booking\s+date|fecha\s+de\s+(la\s+)?operaci[oó]n)$/i,
  valor: /^(f\.?\s*valor|fecha\s+valor|valor)$/i,
  concepto: /^(concepto|descripci[oó]n|detalle|movimiento\s+concepto|observaciones|description|details|reference)$/i,
  importe: /^(importe|movimiento|cantidad|importe\s*\(?€?\)?|importe\s+eur|amount|amount\s*\(?eur\)?)$/i,
  debe: /^(debe|cargo|cargos|salidas|reintegros|d[eé]bito|dinero\s+saliente|salida\s+de\s+dinero|money\s+out|paid\s+out|withdrawals?)$/i,
  haber: /^(haber|abono|abonos|entradas|ingresos|cr[eé]dito|dinero\s+entrante|entrada\s+de\s+dinero|money\s+in|paid\s+in|deposits?)$/i,
  saldo: /^(saldo|saldo\s*\(?€?\)?|saldo\s+eur|saldo\s+disponible|balance)$/i,
};
const SKIP_LINE = /(saldo\s+(anterior|inicial|final|a\s+\d)|total(es)?\s|suma\s|p[aá]gina\s+\d|p[aá]g\.\s*\d|^total$)/i;
const NEG_WORDS = /(recibo|compra|retirada|reintegro|cajero|transferencia\s+a\b|transf\.?\s+a\b|enviad|comisi[oó]n|cuota|pago|cargo|adeudo|domiciliaci|impuesto|tasa)/i;
const POS_WORDS = /(abono|ingreso|recibid|n[oó]mina|devoluci[oó]n|reembolso|intereses\s+a\s+favor|bonificaci)/i;

const norm = (s) => s.replace(/\s+/g, " ").trim();

/** Extrae los fragmentos de texto con su posición de todas las páginas. */
export async function extractItems(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [, , , d, e, f] = it.transform;
      const h = Math.abs(d) || it.height || 8;
      items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, h, page: p });
    }
  }
  return { items, numPages: doc.numPages };
}

/** Agrupa fragmentos en líneas y celdas (fragmentos contiguos se unen). */
export function buildLines(items) {
  const byPage = new Map();
  for (const it of items) {
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page).push(it);
  }
  const lines = [];
  for (const [page, its] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    its.sort((a, b) => a.y - b.y || a.x - b.x);
    let cur = null;
    for (const it of its) {
      const tol = Math.max(2, it.h * 0.45);
      if (cur && Math.abs(it.y - cur.y) <= tol) cur.items.push(it);
      else {
        cur = { page, y: it.y, h: it.h, items: [it] };
        lines.push(cur);
      }
    }
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of ln.items) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - (last.x + last.w) : Infinity;
      const charW = (it.w / Math.max(it.str.length, 1)) || it.h * 0.5;
      if (last && gap < Math.max(charW * 1.2, 2.2)) {
        last.str += (gap > charW * 0.25 ? " " : "") + it.str;
        last.w = it.x + it.w - last.x;
      } else cells.push({ str: it.str, x: it.x, w: it.w });
    }
    for (const c of cells) c.str = norm(c.str);
    ln.cells = cells.filter((c) => c.str);
    ln.text = ln.cells.map((c) => c.str).join(" ");
  }
  return lines;
}

function detectNumberFormat(lines) {
  let es = 0, en = 0;
  for (const ln of lines) for (const c of ln.cells) {
    if (AMT_ES.test(c.str)) es++;
    if (AMT_EN.test(c.str)) en++;
  }
  return en > es * 1.5 ? "en" : "es";
}

function parseAmount(s, fmt) {
  const m = (fmt === "en" ? AMT_EN : AMT_ES).exec(s.trim());
  if (!m) return null;
  const intPart = m[2].replace(fmt === "en" ? /,/g : /\./g, "");
  let v = parseFloat(intPart + "." + m[3]);
  const sign = m[1] || m[5];
  const signed = !!sign;
  if (sign && /[-−]/.test(sign)) v = -v;
  return { v, signed };
}

function parseDateParts(s) {
  let m = DATE_RE.exec(s);
  if (m) {
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    let y = m[3] ? +m[3] : null;
    if (y !== null && y < 100) y += 2000;
    return { d, m: mo, y };
  }
  m = DATE_MDY_RE.exec(s);
  if (m) return { d: +m[2], m: MONTHS[m[1].toLowerCase().slice(0, 3)], y: +m[3] };
  m = DATE_TXT_RE.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
    let y = m[3] ? +m[3] : null;
    if (y !== null && y < 100) y += 2000;
    return { d: +m[1], m: mo, y };
  }
  return null;
}

/** Clasifica cada celda: fecha, importe o texto. Separa "01/09/2026 RECIBO..." en fecha + texto. */
function classify(ln, fmt) {
  const out = [];
  for (const c of ln.cells) {
    const date = parseDateParts(c.str);
    if (date) { out.push({ ...c, kind: "date", date }); continue; }
    const amt = parseAmount(c.str, fmt);
    if (amt) { out.push({ ...c, kind: "amount", amt }); continue; }
    const pre = /^(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)\s+(.+)$/.exec(c.str);
    if (pre && parseDateParts(pre[1])) {
      const frac = pre[1].length / c.str.length;
      out.push({ str: pre[1], x: c.x, w: c.w * frac, kind: "date", date: parseDateParts(pre[1]) });
      out.push({ str: pre[2], x: c.x + c.w * frac, w: c.w * (1 - frac), kind: "text" });
      continue;
    }
    const post = /^(.+?)\s+([+\-−]?\s*[\d.,]+,\d{2}\s*€?|[+\-−]?\s*[\d,]+\.\d{2}\s*€?)$/.exec(c.str);
    if (post && parseAmount(post[2], fmt)) {
      const frac = post[1].length / c.str.length;
      out.push({ str: post[1], x: c.x, w: c.w * frac, kind: "text" });
      out.push({ str: post[2], x: c.x + c.w * frac, w: c.w * (1 - frac), kind: "amount", amt: parseAmount(post[2], fmt) });
      continue;
    }
    out.push({ ...c, kind: "text" });
  }
  return out;
}

function detectHeader(ln) {
  const cols = {};
  let hits = 0;
  for (const c of ln.cells) {
    for (const [k, re] of Object.entries(HDR)) {
      if (re.test(c.str) && !cols[k]) { cols[k] = { x: c.x, w: c.w, cx: c.x + c.w / 2, r: c.x + c.w }; hits++; break; }
    }
  }
  const amountCols = ["importe", "debe", "haber", "saldo"].filter((k) => cols[k]).length;
  return hits >= 2 && amountCols >= 1 ? cols : null;
}

function nearestRole(cell, header, roles) {
  let best = null, bd = Infinity;
  const cx = cell.x + cell.w / 2, r = cell.x + cell.w;
  for (const k of roles) {
    const h = header[k];
    if (!h) continue;
    const d = Math.min(Math.abs(cx - h.cx), Math.abs(r - h.r), Math.abs(cell.x - h.x));
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

const round2 = (v) => Math.round(v * 100) / 100;
const close = (a, b) => Math.abs(a - b) < 0.005;

/** Corrige signos con el saldo y decide el orden (cronológico o inverso). */
function reconcile(txs, opening) {
  const hasSaldo = txs.filter((t) => t.saldo !== null).length >= Math.max(2, txs.length * 0.6);
  if (!hasSaldo) { for (const t of txs) t.cuadra = null; return { checked: 0, ok: 0, reversed: false }; }
  const run = (order) => {
    let prev = opening, ok = 0, checked = 0, flips = [], marks = new Map();
    for (const t of order) {
      if (t.saldo === null) { prev = null; continue; }
      if (prev !== null) {
        checked++;
        if (close(prev + t.importe, t.saldo)) { ok++; marks.set(t, true); }
        else if (!t.signed && close(prev - t.importe, t.saldo)) { ok++; flips.push(t); marks.set(t, true); }
        else marks.set(t, false);
      }
      prev = t.saldo;
    }
    return { ok, checked, flips, marks };
  };
  const fwd = run(txs);
  // En orden inverso el saldo de referencia es el de la fila siguiente en el documento.
  const revFix = (() => {
    let ok = 0, checked = 0, flips = [], marks = new Map();
    for (let i = txs.length - 2; i >= 0; i--) {
      const t = txs[i], older = txs[i + 1];
      if (t.saldo === null || older.saldo === null) continue;
      checked++;
      if (close(older.saldo + t.importe, t.saldo)) { ok++; marks.set(t, true); }
      else if (!t.signed && close(older.saldo - t.importe, t.saldo)) { ok++; flips.push(t); marks.set(t, true); }
      else marks.set(t, false);
    }
    return { ok, checked, flips, marks };
  })();
  const useRev = revFix.ok > fwd.ok;
  const best = useRev ? revFix : fwd;
  for (const t of best.flips) t.importe = -t.importe;
  for (const t of txs) t.cuadra = best.marks.has(t) ? best.marks.get(t) : null;
  // Primer movimiento sin saldo previo: si no lleva signo, se deduce por el texto.
  const first = useRev ? txs[txs.length - 1] : txs[0];
  if (first && !first.signed && opening === null && !best.flips.includes(first)) {
    if (NEG_WORDS.test(first.concepto) && !POS_WORDS.test(first.concepto)) first.importe = -Math.abs(first.importe);
  }
  return { checked: best.checked, ok: best.ok, reversed: useRev };
}

/**
 * Convierte las líneas del PDF en movimientos.
 * Devuelve { movimientos, resumen, avisos }.
 */
export function parseStatement(items) {
  const lines = buildLines(items);
  const fmt = detectNumberFormat(lines);
  const years = new Map();
  for (const ln of lines) for (const c of ln.cells) {
    const d = parseDateParts(c.str);
    if (d && d.y) years.set(d.y, (years.get(d.y) || 0) + 1);
  }
  const defaultYear = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getFullYear();

  let header = null, opening = null, last = null;
  const txs = [];
  for (const ln of lines) {
    const h = detectHeader(ln);
    if (h) { header = h; last = null; continue; }
    const cls = classify(ln, fmt);
    const dates = cls.filter((c) => c.kind === "date");
    const amts = cls.filter((c) => c.kind === "amount");
    const texts = cls.filter((c) => c.kind === "text");

    if (/saldo\s+(anterior|inicial)/i.test(ln.text) && amts.length) {
      if (opening === null && txs.length === 0) opening = amts[amts.length - 1].amt.v;
      last = null;
      continue;
    }
    if (dates.length && amts.length && !SKIP_LINE.test(texts.map((t) => t.str).join(" "))) {
      let fecha = dates[0], valor = dates[1] || null;
      if (header && header.valor && header.fecha && dates.length >= 2) {
        const byRole = (role) => dates.reduce((a, b) => (Math.abs(b.x - header[role].x) < Math.abs(a.x - header[role].x) ? b : a));
        fecha = byRole("fecha"); valor = byRole("valor");
        if (fecha === valor) valor = dates.find((d) => d !== fecha) || null;
      }
      let importe = null, saldo = null, signed = false, debe = null, haber = null;
      const roles = header ? ["importe", "debe", "haber", "saldo"].filter((k) => header[k]) : [];
      if (roles.length) {
        for (const a of amts) {
          const role = nearestRole(a, header, roles);
          if (role === "saldo") saldo = a.amt.v;
          else if (role === "debe") debe = Math.abs(a.amt.v);
          else if (role === "haber") haber = Math.abs(a.amt.v);
          else { importe = a.amt.v; signed = a.amt.signed; }
        }
        if (debe !== null || haber !== null) { importe = round2((haber || 0) - (debe || 0)); signed = true; }
        if (importe === null && amts.length >= 2 && saldo !== null) {
          const a = amts.find((x) => x.amt.v !== saldo) || amts[0];
          importe = a.amt.v; signed = a.amt.signed;
        }
      } else {
        const sorted = [...amts].sort((a, b) => a.x - b.x);
        importe = sorted[0].amt.v; signed = sorted[0].amt.signed;
        if (sorted.length >= 2) saldo = sorted[sorted.length - 1].amt.v;
      }
      if (importe === null) { last = null; continue; }
      const toDate = (p) => (p ? { y: p.date.y ?? defaultYear, m: p.date.m, d: p.date.d } : null);
      last = {
        fecha: toDate(fecha), valor: toDate(valor), concepto: texts.map((t) => t.str).join(" "),
        importe: round2(importe), saldo: saldo === null ? null : round2(saldo), signed,
        page: ln.page, y: ln.y, h: ln.h, x0: texts[0]?.x ?? null,
      };
      txs.push(last);
      continue;
    }
    // Línea de continuación del concepto (sin fecha ni importe, justo debajo).
    if (last && !dates.length && !amts.length && texts.length && ln.page === last.page &&
        ln.y - last.y < last.h * 2.6 && !SKIP_LINE.test(ln.text) &&
        (last.x0 === null || Math.abs(texts[0].x - last.x0) < 40)) {
      last.concepto = norm(last.concepto + " · " + ln.text);
      last.y = ln.y;
      continue;
    }
    if (!dates.length || !amts.length) {
      if (last && ln.y - last.y >= last.h * 2.6) last = null;
    }
  }

  const rec = reconcile(txs, opening);
  const iso = (d) => (d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : "");
  const movimientos = txs.map((t) => ({
    fecha: iso(t.fecha), fechaValor: iso(t.valor), concepto: t.concepto, importe: t.importe, saldo: t.saldo, cuadra: t.cuadra,
  }));
  const cargos = round2(movimientos.filter((m) => m.importe < 0).reduce((s, m) => s + m.importe, 0));
  const abonos = round2(movimientos.filter((m) => m.importe > 0).reduce((s, m) => s + m.importe, 0));
  const avisos = [];
  if (!movimientos.length) avisos.push("No se han encontrado movimientos. Si el PDF es una foto o un escaneo, no contiene texto que se pueda leer.");
  if (rec.checked && rec.ok < rec.checked) avisos.push(`${rec.checked - rec.ok} movimiento(s) no cuadran con el saldo: revísalos.`);
  if (!rec.checked && movimientos.length) avisos.push("El extracto no trae columna de saldo, así que no se ha podido comprobar que todo cuadra.");
  return {
    movimientos,
    resumen: {
      numero: movimientos.length, cargos, abonos, neto: round2(abonos + cargos),
      saldoInicial: opening, saldoFinal: rec.reversed ? movimientos[0]?.saldo ?? null : movimientos[movimientos.length - 1]?.saldo ?? null,
      comprobados: rec.checked, cuadran: rec.ok, ordenInverso: rec.reversed, formatoNumeros: fmt,
    },
    avisos,
  };
}
