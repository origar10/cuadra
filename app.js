import * as pdfjsLib from "./vendor/pdf.min.mjs";
import { extractItems, parseStatement } from "./parser.js";
import { categorizar } from "./categorias.js";
import { CONFIG } from "./config.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const num = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const DIA = 864e5;

// ---------- almacenamiento local (puede no estar disponible)
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

// ---------- licencia (Gumroad)
async function verificarLicencia(clave) {
  if (!CONFIG.gumroadProductId || CONFIG.gumroadProductId === "PENDIENTE") throw new Error("Las licencias Pro aún no están disponibles.");
  const r = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    body: new URLSearchParams({ product_id: CONFIG.gumroadProductId, license_key: clave.trim(), increment_uses_count: "false" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error("Esa clave no es válida. Cópiala tal cual del correo de Gumroad.");
  const p = j.purchase || {};
  if (p.refunded || p.chargebacked || p.disputed) throw new Error("Esta compra se reembolsó, así que la licencia ya no está activa.");
  if (p.subscription_ended_at || p.subscription_cancelled_at || p.subscription_failed_at) {
    const fin = p.subscription_ended_at || p.subscription_cancelled_at || p.subscription_failed_at;
    if (new Date(fin) < new Date()) throw new Error("La suscripción de esta licencia ha terminado. Renuévala en Gumroad para seguir.");
  }
  return true;
}

function esPro() {
  const lic = store.get("cuadra_licencia", null);
  return !!(lic && lic.ok && Date.now() - lic.verificada < 14 * DIA);
}

async function revalidar() {
  const lic = store.get("cuadra_licencia", null);
  if (!lic || Date.now() - lic.verificada < 3 * DIA) return;
  try { await verificarLicencia(lic.clave); store.set("cuadra_licencia", { ...lic, ok: true, verificada: Date.now() }); }
  catch (e) { if (!(e instanceof TypeError)) store.set("cuadra_licencia", { ...lic, ok: false }); }
  pintarRestantes();
}

const usados = () => store.get("cuadra_usados", 0);
const restantes = () => Math.max(0, CONFIG.extractosGratis - usados());

// ---------- estado
let lote = []; // [{ nombre, movimientos, resumen, avisos }]
let contado = false;

// ---------- lectura de PDF
async function leerArchivos(files, esEjemplo = false) {
  const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (!pdfs.length) return mostrarError("Ese archivo no es un PDF. Descarga el extracto de tu banco en formato PDF.");
  let seleccion = pdfs;
  let notaLote = "";
  if (!esPro() && pdfs.length > 1) { seleccion = pdfs.slice(0, 1); notaLote = "Convertir varios PDF a la vez es una función Pro: se ha convertido solo el primero."; }
  if (!esEjemplo && !esPro() && restantes() === 0) { $("dlg-limite").showModal(); return; }

  $("zona").classList.add("leyendo");
  $("hoja-filas").innerHTML = "";
  const resultados = [];
  for (const f of seleccion) {
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const { items } = await extractItems(pdfjsLib, data);
      const res = parseStatement(items);
      res.movimientos.forEach((m) => (m.categoria = categorizar(m.concepto, m.importe)));
      resultados.push({ nombre: f.name.replace(/\.pdf$/i, ""), ...res });
    } catch (e) {
      console.error(e);
      resultados.push({ nombre: f.name, movimientos: [], resumen: null, avisos: [/password/i.test(e?.message) ? "Este PDF está protegido con contraseña. Ábrelo y guárdalo sin contraseña para convertirlo." : "No se ha podido leer este PDF. Comprueba que no está dañado."] });
    }
  }
  lote = resultados;
  contado = false;
  if (notaLote) lote[0].avisos.unshift(notaLote);
  await imprimirEnListado();
  pintarResultado();
}

function mostrarError(msg) {
  lote = [{ nombre: "", movimientos: [], resumen: null, avisos: [msg] }];
  pintarResultado();
}

// Las primeras filas "se imprimen" en el papel continuo antes de mostrar la tabla.
async function imprimirEnListado() {
  const movs = lote.flatMap((r) => r.movimientos).slice(0, 15);
  const cont = $("hoja-filas");
  if (!movs.length) { $("zona").classList.remove("leyendo"); return; }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  movs.forEach((m, i) => {
    const d = document.createElement("div");
    d.className = "fila";
    d.style.animationDelay = reduce ? "0s" : `${i * 45}ms`;
    d.innerHTML = `<span>${fechaCorta(m.fecha)}</span><span>${esc(m.concepto)}</span><span class="n" style="color:${m.importe < 0 ? "var(--cargo)" : "var(--abono)"}">${num.format(m.importe)}</span>`;
    cont.appendChild(d);
  });
  await new Promise((r) => setTimeout(r, reduce ? 0 : 700 + movs.length * 45));
}

// ---------- pintar
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fechaCorta = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

function pintarResultado() {
  const movs = lote.flatMap((r) => r.movimientos.map((m) => ({ ...m, archivo: r.nombre })));
  const avisos = lote.flatMap((r) => (lote.length > 1 ? r.avisos.map((a) => `${r.nombre}: ${a}`) : r.avisos));
  const sec = $("resultado");
  sec.hidden = false;

  const comprobados = lote.reduce((s, r) => s + (r.resumen?.comprobados || 0), 0);
  const cuadran = lote.reduce((s, r) => s + (r.resumen?.cuadran || 0), 0);
  const cargos = movs.filter((m) => m.importe < 0).reduce((s, m) => s + m.importe, 0);
  const abonos = movs.filter((m) => m.importe > 0).reduce((s, m) => s + m.importe, 0);

  $("res-titulo").textContent = !movs.length ? "No se han encontrado movimientos"
    : lote.length > 1 ? `${lote.length} extractos convertidos` : "Extracto convertido";
  const est = $("res-estado");
  if (!movs.length) { est.textContent = ""; est.className = "estado"; }
  else if (!comprobados) { est.textContent = "Sin columna de saldo: revisa los importes a mano."; est.className = "estado"; }
  else if (cuadran === comprobados) { est.textContent = `Los saldos cuadran en los ${comprobados} movimientos comprobados.`; est.className = "estado ok"; }
  else { est.textContent = `${comprobados - cuadran} de ${comprobados} movimientos no cuadran con el saldo. Están marcados en rojo.`; est.className = "estado mal"; }

  $("cifras").innerHTML = movs.length ? `
    <div><dt>Movimientos</dt><dd>${movs.length}</dd></div>
    <div><dt>Cargos</dt><dd class="cargo">${eur.format(cargos)}</dd></div>
    <div><dt>Abonos</dt><dd class="abono">${eur.format(abonos)}</dd></div>
    <div><dt>Neto</dt><dd>${eur.format(abonos + cargos)}</dd></div>` : "";

  const av = $("avisos");
  av.hidden = !avisos.length;
  av.textContent = avisos.join(" ");

  const varios = lote.length > 1;
  $("filas").innerHTML = movs.map((m) => `
    <tr class="${m.cuadra === false ? "descuadre" : ""}">
      <td class="num">${fechaCorta(m.fecha)}</td>
      <td>${esc(m.concepto)}${varios ? `<div class="archivo">${esc(m.archivo)}</div>` : ""}</td>
      <td class="cat">${esc(m.categoria)}</td>
      <td class="num ${m.importe < 0 ? "cargo" : "abono"}">${num.format(m.importe)}</td>
      <td class="num">${m.saldo === null ? "" : num.format(m.saldo)}</td>
    </tr>`).join("");
  $("bajar-xlsx").disabled = $("bajar-csv").disabled = !movs.length;
  pintarRestantes();
  sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function pintarRestantes() {
  const pro = esPro();
  const r = restantes();
  $("restantes").textContent = pro ? "Cuadra Pro activo: extractos ilimitados." :
    r === 0 ? "Has usado tus extractos gratis. Hazte Pro para seguir convirtiendo." :
    `${r === 1 ? "Te queda 1" : `Te quedan ${r}`} de ${CONFIG.extractosGratis} extractos gratis. La descarga cuenta como uno.`;
  $("abrir-licencia").textContent = pro ? "Pro activo" : "Tengo una licencia";
}

// ---------- descargas
function contarUso() {
  if (contado || esPro()) return true;
  if (restantes() === 0) { $("dlg-limite").showModal(); return false; }
  store.set("cuadra_usados", usados() + 1);
  contado = true;
  pintarRestantes();
  return true;
}

function nombreSalida(ext) {
  const base = lote.length === 1 ? lote[0].nombre : `extractos-${new Date().toISOString().slice(0, 10)}`;
  return `${base || "extracto"}.${ext}`;
}

function bajar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function filasExport() {
  return lote.flatMap((r) => r.movimientos.map((m) => ({ ...m, archivo: r.nombre })));
}

function bajarXLSX() {
  if (!contarUso()) return;
  const XLSX = window.XLSX;
  const varios = lote.length > 1;
  const aFecha = (iso) => { if (!iso) return null; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
  const cab = ["Fecha", "Fecha valor", "Concepto", "Categoría", "Importe", "Saldo", "Cuadra"];
  if (varios) cab.push("Extracto");
  const movs = filasExport();
  const aoa = [cab, ...movs.map((m) => {
    const f = [aFecha(m.fecha), aFecha(m.fechaValor), m.concepto, m.categoria, m.importe, m.saldo, m.cuadra === null ? "" : m.cuadra ? "Sí" : "No"];
    if (varios) f.push(m.archivo);
    return f;
  })];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  for (let r = 1; r < aoa.length; r++) {
    for (const c of [0, 1]) { const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref]) ws[ref].z = "dd/mm/yyyy"; }
    for (const c of [4, 5]) { const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref]) ws[ref].z = "#,##0.00"; }
  }
  ws["!cols"] = [{ wch: 11 }, { wch: 11 }, { wch: 52 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, ...(varios ? [{ wch: 28 }] : [])];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cab.length - 1 } }) };

  const porCat = new Map();
  for (const m of movs) {
    const c = porCat.get(m.categoria) || { gastos: 0, ingresos: 0, n: 0 };
    if (m.importe < 0) c.gastos += m.importe; else c.ingresos += m.importe;
    c.n++;
    porCat.set(m.categoria, c);
  }
  const res = [["Categoría", "Movimientos", "Ingresos", "Gastos", "Neto"],
    ...[...porCat.entries()].sort((a, b) => a[1].gastos - b[1].gastos)
      .map(([k, v]) => [k, v.n, round(v.ingresos), round(v.gastos), round(v.ingresos + v.gastos)])];
  const tot = res.slice(1).reduce((t, f) => [t[0] + f[1], t[1] + f[2], t[2] + f[3]], [0, 0, 0]);
  res.push(["Total", tot[0], round(tot[1]), round(tot[2]), round(tot[1] + tot[2])]);
  const ws2 = XLSX.utils.aoa_to_sheet(res);
  for (let r = 1; r < res.length; r++) for (const c of [2, 3, 4]) { const ref = XLSX.utils.encode_cell({ r, c }); if (ws2[ref]) ws2[ref].z = "#,##0.00"; }
  ws2["!cols"] = [{ wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen por categoría");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", cellDates: true });
  bajar(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombreSalida("xlsx"));
}
const round = (v) => Math.round(v * 100) / 100;

function bajarCSV() {
  if (!contarUso()) return;
  const varios = lote.length > 1;
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const n = (v) => (v === null || v === undefined ? "" : v.toFixed(2).replace(".", ","));
  const cab = ["Fecha", "Fecha valor", "Concepto", "Categoría", "Importe", "Saldo", "Cuadra", ...(varios ? ["Extracto"] : [])];
  const lineas = [cab.join(";"), ...filasExport().map((m) => [fechaCorta(m.fecha), fechaCorta(m.fechaValor), q(m.concepto), q(m.categoria), n(m.importe), n(m.saldo),
    m.cuadra === null ? "" : m.cuadra ? "Sí" : "No", ...(varios ? [q(m.archivo)] : [])].join(";"))];
  bajar(new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" }), nombreSalida("csv"));
}

// ---------- eventos
const zona = $("zona"), input = $("archivo");
zona.addEventListener("click", (e) => { if (e.target.closest("#ejemplo")) return; input.click(); });
zona.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === zona) { e.preventDefault(); input.click(); } });
input.addEventListener("change", () => { if (input.files.length) leerArchivos(input.files); input.value = ""; });
["dragenter", "dragover"].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add("encima"); }));
["dragleave", "drop"].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove("encima"); }));
zona.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) leerArchivos(e.dataTransfer.files); });
$("elegir").addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
$("ejemplo").addEventListener("click", async (e) => {
  e.stopPropagation();
  const blob = await (await fetch("ejemplo.pdf")).blob();
  // El ejemplo no gasta extractos gratis.
  await leerArchivos([new File([blob], "extracto-ejemplo.pdf", { type: "application/pdf" })], true);
  contado = true;
});
$("bajar-xlsx").addEventListener("click", bajarXLSX);
$("bajar-csv").addEventListener("click", bajarCSV);
$("otro").addEventListener("click", () => {
  $("zona").classList.remove("leyendo");
  $("hoja-filas").innerHTML = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  input.click();
});

const dlg = $("dlg-licencia");
function abrirLicencia() {
  const lic = store.get("cuadra_licencia", null);
  $("clave").value = lic?.clave || "";
  $("lic-estado").textContent = esPro() ? "Licencia activa en este navegador." : "";
  $("lic-estado").className = "estado" + (esPro() ? " ok" : "");
  dlg.showModal();
}
$("abrir-licencia").addEventListener("click", abrirLicencia);
$("limite-licencia").addEventListener("click", () => { $("dlg-limite").close(); abrirLicencia(); });
$("cerrar-licencia").addEventListener("click", () => dlg.close());
$("form-licencia").addEventListener("submit", async (e) => {
  e.preventDefault();
  const clave = $("clave").value.trim();
  const est = $("lic-estado");
  $("activar").disabled = true;
  est.className = "estado"; est.textContent = "Comprobando la licencia…";
  try {
    await verificarLicencia(clave);
    store.set("cuadra_licencia", { clave, ok: true, verificada: Date.now() });
    est.className = "estado ok"; est.textContent = "Licencia activada. Ya tienes extractos ilimitados.";
    pintarRestantes();
    setTimeout(() => dlg.close(), 1200);
  } catch (err) {
    est.className = "estado mal";
    est.textContent = err instanceof TypeError ? "No hay conexión con Gumroad. Comprueba tu internet y vuelve a intentarlo." : err.message;
  } finally { $("activar").disabled = false; }
});

// ---------- arranque
for (const id of ["comprar", "comprar2"]) $(id).href = CONFIG.urlCompra;
$("gratis-n").textContent = $("gratis-n2").textContent = CONFIG.extractosGratis;
$("precio-mes").textContent = CONFIG.precioMes;
$("precio-anio").textContent = CONFIG.precioAnio;
pintarRestantes();
revalidar();
if (location.hash === "#ejemplo") $("ejemplo").click();
