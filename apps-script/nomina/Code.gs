// Apps Script independiente para la hoja "Nómina JACBEL". No tiene relacion
// con apps-script/Code.gs (ese es de la version vieja de esta app, de antes
// de migrar a Supabase, y ya no lo usa nada del backend actual).
//
// Este script SOLO recibe una copia de la nomina calculada en la app
// (Supabase sigue siendo la fuente de verdad) para que el usuario y su
// contadora puedan verla y revisarla en un Google Sheet compartido.

// Cambia este secreto por uno nuevo y ponlo tambien en NOMINA_SHEETS_SECRET
// en el backend (.env local y variables de entorno de Render).
var NOMINA_SHEETS_SECRET = "0Ndnf_OK96lnrwB_5aLoDm_47j6O5E93";

// ID de la hoja de calculo "Nomina JACBEL" (de la URL: .../spreadsheets/d/ESTE_ID/edit).
// Se usa openById en vez de getActiveSpreadsheet porque este script es
// standalone (no esta atado directamente a la hoja como contenedor).
var NOMINA_SHEET_ID = "1C7bmIZIpGZdpezmb06kMmyZmECJ1mEHYfn_DJu19wRo";

var COLUMNAS_NOMINA = ["Obra", "Trabajador", "Cargo", "Forma de pago", "Salario", "Planilla", "Total mensual"];

var COLUMNAS_RESUMEN = [
  "Trabajador", "Semana", "Dias trabajados", "Valor dias",
  "Descuentos", "Horas extra", "Valor horas extra", "Total a pagar",
];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secreto !== NOMINA_SHEETS_SECRET) {
      return jsonOutput_({ ok: false, error: "No autorizado" });
    }
    if (body.accion === "sync_nomina") return syncNomina_(body);
    if (body.accion === "sync_resumen_semana") return syncResumenSemana_(body);
    return jsonOutput_({ ok: false, error: "Accion no reconocida" });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

function syncNomina_(body) {
  var sheet = hojaNomina_();
  var fila = [
    body.obra || "", body.trabajador || "", body.cargo || "", body.frecuenciaPago || "",
    Number(body.salario) || 0, Number(body.planilla) || 0, Number(body.total) || 0,
  ];

  var lastRow = sheet.getLastRow();
  var rowIndex = -1;
  if (lastRow >= 2) {
    var claves = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < claves.length; i++) {
      if (claves[i][0] === fila[0] && claves[i][1] === fila[1]) { rowIndex = i + 2; break; }
    }
  }
  if (rowIndex === -1) {
    sheet.appendRow(fila);
  } else {
    sheet.getRange(rowIndex, 1, 1, fila.length).setValues([fila]);
  }
  return jsonOutput_({ ok: true });
}

function syncResumenSemana_(body) {
  var sheet = hojaResumen_();
  var fila = [
    body.trabajador || "", body.semana || "",
    Number(body.diasTrabajados) || 0, Number(body.valorDias) || 0,
    Number(body.descuentos) || 0, Number(body.horasExtra) || 0,
    Number(body.valorHorasExtra) || 0, Number(body.totalPagar) || 0,
  ];

  var lastRow = sheet.getLastRow();
  var rowIndex = -1;
  if (lastRow >= 2) {
    var claves = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < claves.length; i++) {
      if (claves[i][0] === fila[0] && claves[i][1] === fila[1]) { rowIndex = i + 2; break; }
    }
  }
  if (rowIndex === -1) {
    sheet.appendRow(fila);
  } else {
    sheet.getRange(rowIndex, 1, 1, fila.length).setValues([fila]);
  }
  return jsonOutput_({ ok: true });
}

function hojaNomina_() {
  return obtenerOCrearHoja_("Nomina", COLUMNAS_NOMINA);
}

function hojaResumen_() {
  return obtenerOCrearHoja_("Resumen", COLUMNAS_RESUMEN);
}

function obtenerOCrearHoja_(nombre, encabezados) {
  var ss = SpreadsheetApp.openById(NOMINA_SHEET_ID);
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
    sheet.appendRow(encabezados);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
