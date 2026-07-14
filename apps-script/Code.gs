// ID de la carpeta de Drive donde se guardan las fotos de asistencia.
var FOLDER_ID = "1pn5vATpDB_c7dUk_90rMKyI3qKwO76im";

// Cambia este PIN por uno que solo tu conozcas. Se usa para agregar o quitar
// trabajadores de la lista, para que el encargado no pueda hacerlo por su cuenta.
var ADMIN_PIN = "0106";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.accion === "marcar") return marcar_(body);
    if (body.accion === "agregar_trabajador") return agregarTrabajador_(body);
    if (body.accion === "quitar_trabajador") return quitarTrabajador_(body);
    return jsonOutput_({ ok: false, error: "Accion no reconocida" });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    if (e.parameter.trabajadores === "1") {
      return jsonOutput_(obtenerTrabajadoresConEstado_());
    }
    return jsonOutput_(obtenerRegistrosHoy_());
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function marcar_(body) {
  var trabajador = body.trabajador || "";
  var tipo = body.tipo === "Salida" ? "Salida" : "Entrada";
  var lat = body.lat || "";
  var lng = body.lng || "";
  if (!trabajador) return jsonOutput_({ ok: false, error: "Falta el nombre del trabajador" });

  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var hora = Utilities.formatDate(ahora, Session.getScriptTimeZone(), "HH:mm:ss");

  var thumbnailUrl = "";
  var fotoUrl = "";
  if (body.fotoBase64) {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var decoded = Utilities.base64Decode(body.fotoBase64);
    var blob = Utilities.newBlob(decoded, body.fotoMimeType, body.fotoNombre);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId = file.getId();
    thumbnailUrl = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w800";
    fotoUrl = "https://drive.google.com/file/d/" + fileId + "/view";
  }

  var ubicacionLink = (lat !== "" && lng !== "") ? ("https://maps.google.com/?q=" + lat + "," + lng) : "";

  var sheet = obtenerHoja_("Registros");
  sheet.appendRow([
    fecha, trabajador, tipo, hora, lat, lng,
    ubicacionLink ? '=HYPERLINK("' + ubicacionLink + '","Ver ubicacion")' : "",
    thumbnailUrl ? '=IMAGE("' + thumbnailUrl + '")' : "",
    fotoUrl, ahora.toISOString(),
  ]);

  return jsonOutput_({ ok: true, trabajador: trabajador, tipo: tipo, hora: hora });
}

function agregarTrabajador_(body) {
  if (body.pin !== ADMIN_PIN) return jsonOutput_({ ok: false, error: "PIN incorrecto" });
  var nombre = (body.nombre || "").trim();
  if (!nombre) return jsonOutput_({ ok: false, error: "Falta el nombre" });

  var sheet = obtenerHoja_("Trabajadores");
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var existentes = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < existentes.length; i++) {
      if (existentes[i][0] === nombre) {
        sheet.getRange(i + 2, 2).setValue(true);
        return jsonOutput_({ ok: true });
      }
    }
  }
  sheet.appendRow([nombre, true]);
  return jsonOutput_({ ok: true });
}

function quitarTrabajador_(body) {
  if (body.pin !== ADMIN_PIN) return jsonOutput_({ ok: false, error: "PIN incorrecto" });
  var nombre = body.nombre;
  var sheet = obtenerHoja_("Trabajadores");
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      if (values[i][0] === nombre) {
        sheet.getRange(i + 2, 2).setValue(false);
        break;
      }
    }
  }
  return jsonOutput_({ ok: true });
}

function obtenerTrabajadoresConEstado_() {
  var sheetT = obtenerHoja_("Trabajadores");
  var lastRow = sheetT.getLastRow();
  var trabajadores = [];
  if (lastRow >= 2) {
    var values = sheetT.getRange(2, 1, lastRow - 1, 2).getValues();
    values.forEach(function (r) {
      if (r[0] && r[1] === true) trabajadores.push(r[0]);
    });
  }

  var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var estados = {};
  var sheetR = obtenerHoja_("Registros");
  var lastRowR = sheetR.getLastRow();
  if (lastRowR >= 2) {
    var regs = sheetR.getRange(2, 1, lastRowR - 1, 4).getValues();
    regs.forEach(function (r) {
      if (formatearFecha_(r[0]) === hoy) {
        estados[r[1]] = { tipo: r[2], hora: formatearHora_(r[3]) };
      }
    });
  }

  return trabajadores.map(function (nombre) {
    var estado = estados[nombre];
    return {
      nombre: nombre,
      enObra: !!estado && estado.tipo === "Entrada",
      ultimaHora: estado ? estado.hora : null,
    };
  });
}

function obtenerRegistrosHoy_() {
  var sheetR = obtenerHoja_("Registros");
  var lastRow = sheetR.getLastRow();
  if (lastRow < 2) return [];
  var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var values = sheetR.getRange(2, 1, lastRow - 1, 10).getValues();
  var registros = [];
  values.forEach(function (r) {
    if (formatearFecha_(r[0]) === hoy) {
      registros.push({
        fecha: formatearFecha_(r[0]), trabajador: r[1], tipo: r[2], hora: formatearHora_(r[3]), fotoUrl: r[8],
      });
    }
  });
  registros.reverse();
  return registros;
}

function formatearFecha_(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  if (typeof valor === "object" && typeof valor.getFullYear === "function") {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  var texto = String(valor);
  var m = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : texto;
}

function formatearHora_(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  if (typeof valor === "object" && typeof valor.getHours === "function") {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), "HH:mm:ss");
  }
  var texto = String(valor);
  var m = texto.match(/(\d{2}):(\d{2}):(\d{2})/);
  return m ? m[0] : texto;
}

function obtenerHoja_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
    if (nombre === "Trabajadores") {
      sheet.appendRow(["Nombre", "Activo"]);
    } else if (nombre === "Registros") {
      sheet.appendRow(["Fecha", "Trabajador", "Tipo", "Hora", "Latitud", "Longitud", "Ubicacion", "Foto", "Foto URL", "Registrado"]);
    }
  }
  return sheet;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
