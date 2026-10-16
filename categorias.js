// Categorías automáticas por palabras clave del concepto (bancos y comercios habituales en España).
const REGLAS = [
  ["Nómina", /n[oó]mina|salario/],
  ["Impuestos y Seg. Social", /aeat|hacienda|agencia\s+tributaria|seguridad\s+social|tgss|impuesto|ibi\b|tasa\s+municipal|modelo\s+\d{3}/],
  ["Supermercado", /mercadona|carrefour|lidl|\bdia\b|alcampo|eroski|aldi|consum|hipercor|bonpreu|caprabo|ahorramas|gadis|froiz|spar|supermercado/],
  ["Suministros", /endesa|iberdrola|naturgy|holaluz|totalenergies|repsol\s+(luz|gas)|canal\s+de\s+isabel|aguas?\b|emasesa|aigues|gas\s+natural|electric/],
  ["Telefonía e internet", /movistar|telef[oó]nica|vodafone|orange|digi\b|jazztel|masmovil|m[aá]sm[oó]vil|pepephone|yoigo|lowi|simyo|o2\b|finetwork/],
  ["Combustible", /repsol|cepsa|moeve|\bbp\b|galp|shell|petronor|ballenoil|plenoil|gasolinera|estaci[oó]n\s+de\s+servicio|estacion/],
  ["Vivienda", /alquiler|hipoteca|comunidad\s+de\s+propietarios|comunidad\s+prop/],
  ["Seguros", /seguro|mapfre|mutua|axa\b|allianz|sanitas|adeslas|asisa|dkv|generali|linea\s+directa|l[ií]nea\s+directa/],
  ["Compras", /amazon|aliexpress|zara|corte\s+ingl[eé]s|ikea|decathlon|mediamarkt|primark|shein|temu|leroy/],
  ["Restauración", /restaurante|\bbar\b|cafeter|glovo|just\s*eat|uber\s*eats|telepizza|mcdonald|burger|starbucks/],
  ["Transporte", /renfe|\buber\b|cabify|bolt\b|metro|emt\b|parking|aparcamiento|autopista|peaje|vueling|iberia|ryanair|blablacar/],
  ["Suscripciones", /netflix|spotify|hbo|max\.com|disney|prime\s+video|apple\.com|icloud|google\s+(one|play|storage)|youtube|chatgpt|openai|adobe|microsoft/],
  ["Salud y deporte", /farmacia|cl[ií]nica|dentist|hospital|gimnasio|basic\s*fit|mcfit|holmes\s+place|fisio/],
  ["Comisiones bancarias", /comisi[oó]n|mantenimiento\s+cuenta|cuota\s+tarjeta|intereses\s+deudores/],
  ["Efectivo", /cajero|retirada|reintegro|ingreso\s+efectivo|disposici[oó]n\s+efectivo/],
  ["Bizum", /bizum/],
  ["Transferencias", /transferencia|transf\.?|traspaso/],
  ["Recibos", /recibo|adeudo|domiciliaci/],
];

export function categorizar(concepto, importe) {
  const c = (concepto || "").toLowerCase();
  for (const [nombre, re] of REGLAS) if (re.test(c)) return nombre;
  return importe > 0 ? "Otros ingresos" : "Otros gastos";
}
