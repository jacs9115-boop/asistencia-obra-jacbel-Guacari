const PDFDocument = require("pdfkit");

function formatoMoneda(valor) {
  return "$" + Math.round(valor || 0).toLocaleString("es-CO");
}

function formatoFechaLegible(fechaStr) {
  const [y, m, d] = fechaStr.split("-");
  return `${d}/${m}/${y}`;
}

function etiquetaTipoDia(tipo) {
  if (tipo === "festivo") return "Festivo";
  if (tipo === "sabado") return "Sábado";
  if (tipo === "domingo") return "Domingo";
  return "Laboral";
}

const COLS = [
  { titulo: "Fecha", ancho: 60 },
  { titulo: "Día", ancho: 55 },
  { titulo: "Tipo", ancho: 50 },
  { titulo: "Entrada", ancho: 50 },
  { titulo: "Salida", ancho: 50 },
  { titulo: "Valor día", ancho: 70 },
  { titulo: "Descuento", ancho: 70 },
  { titulo: "H.Extra", ancho: 45 },
  { titulo: "Valor extra", ancho: 70 },
  { titulo: "Total día", ancho: 75 },
];
const ANCHO_TABLA = COLS.reduce((s, c) => s + c.ancho, 0);
const MARGEN_X = 40;
const ALTO_PAGINA_UTIL = 555;

function xColumna(idx) {
  let x = MARGEN_X;
  for (let i = 0; i < idx; i++) x += COLS[i].ancho;
  return x;
}
function dibujarEncabezadoTabla(doc, y) {
  doc.fontSize(8).font("Helvetica-Bold");
  COLS.forEach((c, i) => {
    doc.text(c.titulo, xColumna(i), y, { width: c.ancho, align: "left" });
  });
  doc.moveTo(MARGEN_X, y + 13).lineTo(MARGEN_X + ANCHO_TABLA, y + 13).strokeColor("#999").lineWidth(0.5).stroke();
  return y + 18;
}

function asegurarEspacio_(doc, y, alturaNecesaria, callbackEncabezado) {
  if (y + alturaNecesaria > ALTO_PAGINA_UTIL) {
    doc.addPage();
    let nuevaY = 40;
    if (callbackEncabezado) nuevaY = callbackEncabezado(nuevaY);
    return nuevaY;
  }
  return y;
}

function generarPDFLiquidacion(res, resultado) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
  doc.pipe(res);

  doc.fontSize(16).font("Helvetica-Bold").fillColor("#1F4E78").text("Liquidación de Nómina", MARGEN_X, 40);
  doc.fontSize(11).font("Helvetica").fillColor("#333").text("Asistencia Obra Guacarí", MARGEN_X, 62);
  doc.fontSize(10).fillColor("#555").text(
    `Del ${formatoFechaLegible(resultado.desde)} al ${formatoFechaLegible(resultado.hasta)}  ·  Generado: ${new Date().toLocaleString("es-CO")}`,
    MARGEN_X, 80
  );

  let y = 110;
  resultado.trabajadores.forEach((t, idxTrabajador) => {
    y = asegurarEspacio_(doc, y, 90);
    if (idxTrabajador > 0) y += 10;

    doc.fontSize(13).font("Helvetica-Bold").fillColor("#000").text(t.nombre, MARGEN_X, y);
    y += 16;
    doc.fontSize(9).font("Helvetica").fillColor("#666").text(
      `Valor semanal: ${formatoMoneda(t.valorSemanal)}  ·  Valor día: ${formatoMoneda(t.valorSemanal / 6)}`,
      MARGEN_X, y
    );
    y += 18;

    y = dibujarEncabezadoTabla(doc, y);

    if (!t.dias.length) {
      doc.fontSize(9).font("Helvetica").fillColor("#888").text("Sin días registrados en este rango.", MARGEN_X, y);
      y += 20;
    }
    t.dias.forEach((d) => {
      const filaAltura = d.descuentoTotal > 0 ? 26 : 15;
      y = asegurarEspacio_(doc, y, filaAltura, (nuevaY) => dibujarEncabezadoTabla(doc, nuevaY));

      doc.fontSize(8.5).font("Helvetica").fillColor("#000");
      doc.text(formatoFechaLegible(d.fecha), xColumna(0), y, { width: COLS[0].ancho });
      doc.text(d.diaSemana, xColumna(1), y, { width: COLS[1].ancho });
      doc.text(etiquetaTipoDia(d.tipoDia), xColumna(2), y, { width: COLS[2].ancho });
      doc.text(d.horaEntrada.slice(0, 5), xColumna(3), y, { width: COLS[3].ancho });
      doc.text(d.horaSalida.slice(0, 5), xColumna(4), y, { width: COLS[4].ancho });
      doc.text(formatoMoneda(d.valorDia), xColumna(5), y, { width: COLS[5].ancho });
      doc.fillColor(d.descuentoTotal > 0 ? "#C0392B" : "#000");
      doc.text(d.descuentoTotal > 0 ? "-" + formatoMoneda(d.descuentoTotal) : "-", xColumna(6), y, { width: COLS[6].ancho });
      doc.fillColor("#000");
      doc.text(d.horasExtra > 0 ? d.horasExtra.toFixed(2) : "-", xColumna(7), y, { width: COLS[7].ancho });
      doc.text(d.valorExtra > 0 ? formatoMoneda(d.valorExtra) : "-", xColumna(8), y, { width: COLS[8].ancho });
      doc.font("Helvetica-Bold").text(formatoMoneda(d.valorNeto), xColumna(9), y, { width: COLS[9].ancho });
      doc.font("Helvetica");
      y += 13;
      if (d.descuentoTotal > 0) {
        const partes = [];
        if (d.retrasoMin > 0) partes.push(`llegó ${d.retrasoMin} min tarde (-${formatoMoneda(d.descuentoRetraso)})`);
        if (d.salidaTempranoMin > 0) partes.push(`salió ${d.salidaTempranoMin} min temprano (-${formatoMoneda(d.descuentoSalidaTemprano)})`);
        doc.fontSize(7.5).font("Helvetica-Oblique").fillColor("#B26A00").text(
          `Descuento: ${partes.join(" · ")}`,
          xColumna(0), y, { width: ANCHO_TABLA }
        );
        y += 12;
      }
      doc.fillColor("#000");
    });

    y += 4;
    doc.moveTo(MARGEN_X, y).lineTo(MARGEN_X + ANCHO_TABLA, y).strokeColor("#999").lineWidth(0.5).stroke();
    y += 8;

    y = asegurarEspacio_(doc, y, 60);
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#000");
    doc.text(`Días trabajados: ${t.totalDiasTrabajados}`, MARGEN_X, y);
    doc.text(`Valor por días: ${formatoMoneda(t.totalValorDias)}`, MARGEN_X + 160, y);
    doc.text(`Descuentos: -${formatoMoneda(t.totalDescuentos)}`, MARGEN_X + 340, y);
    y += 14;
    doc.text(`Horas extra: ${t.totalHorasExtra.toFixed(2)}`, MARGEN_X, y);
    doc.text(`Valor horas extra: ${formatoMoneda(t.totalValorExtra)}`, MARGEN_X + 160, y);
    y += 16;
    doc.fontSize(11).fillColor("#1F4E78").text(`TOTAL A PAGAR: ${formatoMoneda(t.totalPagar)}`, MARGEN_X, y);
    y += 24;
  });
  if (resultado.trabajadores.length > 1) {
    y = asegurarEspacio_(doc, y, 40 + resultado.trabajadores.length * 16);
    y += 10;
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#1F4E78").text("Resumen general", MARGEN_X, y);
    y += 18;
    doc.fontSize(9).font("Helvetica").fillColor("#000");
    resultado.trabajadores.forEach((t) => {
      doc.text(t.nombre, MARGEN_X, y, { width: 250 });
      doc.text(formatoMoneda(t.totalPagar), MARGEN_X + 250, y, { width: 150, align: "right" });
      y += 15;
    });
    y += 6;
    doc.moveTo(MARGEN_X, y).lineTo(MARGEN_X + 400, y).strokeColor("#999").lineWidth(0.5).stroke();
    y += 10;
    doc.fontSize(13).font("Helvetica-Bold").fillColor("#1F4E78").text(`GRAN TOTAL: ${formatoMoneda(resultado.granTotal)}`, MARGEN_X, y);
  }

  doc.end();
}

module.exports = { generarPDFLiquidacion, formatoMoneda };
