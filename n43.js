// Generación de ficheros Norma 43 (AEB, cuaderno 43): el formato estándar de movimientos bancarios
// que importan los programas de contabilidad españoles. Registros de 80 caracteres.

const IBAN_RE = /\bES\s?\d{2}(?:[\s-]?\d{4}){5}\b/g;

/** Valida un IBAN con el algoritmo módulo 97. */
export function ibanValido(iban) {
  const s = iban.replace(/[\s-]/g, "").toUpperCase();
  if (!/^ES\d{22}$/.test(s)) return false;
  const reord = s.slice(4) + s.slice(0, 4);
  const num = reord.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of num) r = (r * 10 + +ch) % 97;
  return r === 1;
}

/** Busca el primer IBAN español válido en el texto del PDF. */
export function buscarIban(texto) {
  for (const m of texto.matchAll(IBAN_RE)) {
    const s = m[0].replace(/[\s-]/g, "");
    if (ibanValido(s)) return s;
  }
  return null;
}

export function partesIban(iban) {
  const s = iban.replace(/[\s-]/g, "").toUpperCase();
  return { entidad: s.slice(4, 8), oficina: s.slice(8, 12), dc: s.slice(12, 14), cuenta: s.slice(14, 24) };
}

// Concepto común AEB a partir de la categoría y el texto del movimiento.
function conceptoComun(m) {
  const c = (m.concepto || "").toLowerCase();
  if (/comisi|intereses|mantenimiento/.test(c)) return "17";
  if (/tarj|compra\s+tarj|pago\s+con\s+tarjeta/.test(c)) return "12";
  if (/recibo|adeudo|domicilia/.test(c) || ["Suministros", "Telefonía e internet", "Seguros", "Recibos"].includes(m.categoria)) return "03";
  if (/transf|bizum|n[oó]mina|traspaso/.test(c)) return "04";
  if (/cajero|retirada|reintegro/.test(c)) return "99";
  return "99";
}

const sinAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[ñÑ]/g, (x) => (x === "ñ" ? "n" : "N"));
const limpio = (s) => sinAcentos(String(s ?? "")).toUpperCase().replace(/[^A-Z0-9 .,\-\/:()&*+]/g, " ").replace(/\s+/g, " ").trim();
const izq = (s, n) => limpio(s).slice(0, n).padEnd(n, " ");
const num = (v, n) => String(Math.round(Math.abs(v) * 100)).padStart(n, "0").slice(-n);
const ent = (v, n) => String(v).padStart(n, "0").slice(-n);
const aammdd = (iso) => (iso ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : "000000");

/**
 * Genera el fichero Norma 43 de una cuenta.
 * movimientos: [{ fecha, fechaValor, concepto, categoria, importe, saldo }] en cualquier orden.
 * Devuelve el texto con saltos CRLF.
 */
function bloqueCuenta({ iban, titular, movimientos, saldoInicial = null, divisa = "978" }) {
  if (!iban || !ibanValido(iban)) throw new Error("Hace falta un IBAN español válido para generar el fichero Norma 43.");
  const { entidad, oficina, cuenta } = partesIban(iban);
  const movs = [...movimientos].map((m, i) => ({ ...m, i })).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) || 0);
  // Si el extracto venía al revés (más reciente primero), el orden estable por fecha deja los del mismo día invertidos:
  // se corrige comprobando la cadena de saldos.
  const conSaldo = movs.filter((m) => m.saldo !== null);
  if (conSaldo.length >= 2) {
    const encadena = (lista) => lista.slice(1).filter((m, k) => m.saldo !== null && lista[k].saldo !== null && Math.abs(lista[k].saldo + m.importe - m.saldo) < 0.005).length;
    const alt = [...movs].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : b.i - a.i));
    if (encadena(alt) > encadena(movs)) movs.splice(0, movs.length, ...alt);
  }
  if (!movs.length) throw new Error("No hay movimientos para exportar.");

  let inicial = saldoInicial;
  if (inicial === null) {
    const p = movs[0];
    inicial = p.saldo !== null ? Math.round((p.saldo - p.importe) * 100) / 100 : 0;
  }
  const debe = movs.filter((m) => m.importe < 0);
  const haber = movs.filter((m) => m.importe > 0);
  const totDebe = debe.reduce((s, m) => s - m.importe, 0);
  const totHaber = haber.reduce((s, m) => s + m.importe, 0);
  const final = Math.round((inicial + totHaber - totDebe) * 100) / 100;

  const lineas = [];
  lineas.push("11" + entidad + oficina + cuenta + aammdd(movs[0].fecha) + aammdd(movs[movs.length - 1].fecha) +
    (inicial < 0 ? "1" : "2") + num(inicial, 14) + divisa + "3" + izq(titular || "", 26) + "   ");
  for (const m of movs) {
    lineas.push("22" + "    " + oficina + aammdd(m.fecha) + aammdd(m.fechaValor || m.fecha) + conceptoComun(m) + "000" +
      (m.importe < 0 ? "1" : "2") + num(m.importe, 14) + "0000000000" + izq("", 12) + izq("", 16));
    const texto = limpio(m.concepto);
    for (let k = 0, n = 1; k < texto.length && n <= 5; k += 76, n++) {
      const trozo = texto.slice(k, k + 76);
      lineas.push("23" + ent(n, 2) + trozo.slice(0, 38).padEnd(38, " ") + trozo.slice(38, 76).padEnd(38, " "));
    }
  }
  lineas.push("33" + entidad + oficina + cuenta + ent(debe.length, 5) + num(totDebe, 14) + ent(haber.length, 5) + num(totHaber, 14) +
    (final < 0 ? "1" : "2") + num(final, 14) + divisa + "    ");
  return lineas;
}

/** Fichero Norma 43 con una o varias cuentas. cuentas: [{ iban, titular, movimientos, saldoInicial }]. */
export function generarFicheroNorma43(cuentas) {
  const lineas = cuentas.flatMap((c) => bloqueCuenta(c));
  lineas.push("88" + "9".repeat(18) + ent(lineas.length, 6) + " ".repeat(54));
  for (const l of lineas) if (l.length !== 80) throw new Error(`Registro Norma 43 con longitud ${l.length}: ${l}`);
  return lineas.join("\r\n") + "\r\n";
}

/** Fichero Norma 43 de una sola cuenta. */
export function generarNorma43(cuenta) {
  return generarFicheroNorma43([cuenta]);
}

/** Lector mínimo de Norma 43 (para comprobar los ficheros generados). */
export function leerNorma43(texto) {
  const out = { cuenta: null, saldoInicial: null, saldoFinal: null, movimientos: [], registros: 0 };
  let ultimo = null;
  for (const l of texto.split(/\r?\n/).filter(Boolean)) {
    const t = l.slice(0, 2);
    if (t === "11") {
      out.cuenta = l.slice(2, 20);
      out.saldoInicial = (l[32] === "1" ? -1 : 1) * (+l.slice(33, 47) / 100);
    } else if (t === "22") {
      ultimo = { fecha: l.slice(10, 16), valor: l.slice(16, 22), comun: l.slice(22, 24), importe: (l[27] === "1" ? -1 : 1) * (+l.slice(28, 42) / 100), concepto: "" };
      out.movimientos.push(ultimo);
    } else if (t === "23" && ultimo) {
      ultimo.concepto = (ultimo.concepto + " " + l.slice(4).trim()).trim();
    } else if (t === "33") {
      out.saldoFinal = (l[58] === "1" ? -1 : 1) * (+l.slice(59, 73) / 100);
      out.apuntesDebe = +l.slice(20, 25);
      out.apuntesHaber = +l.slice(39, 44);
    } else if (t === "88") out.registros = +l.slice(20, 26);
  }
  return out;
}
