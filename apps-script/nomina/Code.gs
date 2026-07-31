// Apps Script independiente para la hoja "Nómina JACBEL". No tiene relacion
// con apps-script/Code.gs (ese es de la version vieja de esta app, de antes
// de migrar a Supabase, y ya no lo usa nada del backend actual).
//
// Este script SOLO recibe una copia de la nomina calculada en la app
// (Supabase sigue siendo la fuente de verdad) para que el usuario y su
// contadora puedan verla y revisarla en un Google Sheet compartido.

// Cambia este secreto por uno nuevo y ponlo tambien en NOMINA_SHEETS_SECRET
// en el backend (.env local y variables de entorno de Render).
var NOMINA_SHEETS_SECRET = "CAMBIA_ESTE_SECRETO";

var COLUMNAS_NOMINA = [
  "Obra", "Trabajador", "Cargo", "Frecuencia de pago", "Salario",
  "Salario mensualizado", "Auxilio transporte", "Valor auxilio",
  "Valor hora extra", "Horas extra (mes)", "Valor horas extra",
  "Descuentos (mes)", "Salud", "Pension", "Total mensual", "Ultima actualizacion",
];

var COLUMNAS_CARGOS = ["Cargo", "Valor de planilla", "Ultima actualizacion"];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secreto !== NOMINA_SHEETS_SECRET) {
      return jsonOutput_({ ok: false, error: "No autorizado" });
    }
    if (body.accion === "sync_nomina") return syncNomina_(body);
    if (body.accion === "sync_cargo") return syncCargo_(body);
    return jsonOutput_({ ok: false, error: "Accion no reconocida" });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

function syncNomina_(body) {
  var sheet = hojaNomina_();
  var fila = [
    body.obra || "", body.trabajador || "", body.cargo || "", body.frecuenciaPago || "",
    Number(body.salario) || 0, Number(body.salarioMensual) || 0,
    body.tieneAuxilioTransporte ? "Si" : "No", Number(body.valorAuxilioTransporte) || 0,
    Number(body.valorHoraExtra) || 0, Number(body.horasExtra) || 0, Number(body.valorHorasExtra) || 0,
    Number(body.descuentos) || 0, Number(body.salud) || 0, Number(body.pension) || 0,
    Number(body.total) || 0, new Date().toISOString(),
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

function syncCargo_(body) {
  var sheet = hojaCargos_();
  var nombre = body.nombre || "";
  var fila = [nombre, Number(body.valorPlanilla) || 0, new Date().toISOString()];

  var lastRow = sheet.getLastRow();
  var rowIndex = -1;
  if (lastRow >= 2) {
    var nombres = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < nombres.length; i++) {
      if (nombres[i][0] === nombre) { rowIndex = i + 2; break; }
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

function hojaCargos_() {
  return obtenerOCrearHoja_("Cargos", COLUMNAS_CARGOS);
}

function obtenerOCrearHoja_(nombre, encabezados) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
