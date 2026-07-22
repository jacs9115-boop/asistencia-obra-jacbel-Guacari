// ---------- Festivos de Colombia (calculados, no hardcodeados por ano) ----------
//
// Domingo de Pascua via el algoritmo de Gauss (anonymous Gregorian algorithm).
// A partir de ahi se ubican los festivos moviles: los que dependen
// directamente de la Semana Santa (Jueves y Viernes Santo, que NO se
// trasladan) y los que la Ley Emiliani traslada al lunes siguiente si no
// caen ya en lunes (Ascension, Corpus Christi, Sagrado Corazon, y los
// festivos civiles/religiosos de fecha fija que tambien se trasladan).

function calcularPascua_(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, mes - 1, dia);
}
function sumarDias_(fecha, dias) {
  const d = new Date(fecha.getTime());
  d.setDate(d.getDate() + dias);
  return d;
}

function moverALunes_(fecha) {
  const d = new Date(fecha.getTime());
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

function formatoFecha_(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function festivosColombia_(year) {
  const pascua = calcularPascua_(year);
  const fijos = [
    new Date(year, 0, 1), // Año nuevo
    new Date(year, 4, 1), // Dia del trabajo
    new Date(year, 6, 20), // Independencia
    new Date(year, 7, 7), // Batalla de Boyaca
    new Date(year, 11, 8), // Inmaculada Concepcion
    new Date(year, 11, 25), // Navidad
    sumarDias_(pascua, -3), // Jueves santo
    sumarDias_(pascua, -2), // Viernes santo
  ];
  const trasladables = [
    new Date(year, 0, 6), // Reyes magos
    new Date(year, 2, 19), // San Jose
    sumarDias_(pascua, 39), // Ascension del senor
    sumarDias_(pascua, 60), // Corpus christi
    sumarDias_(pascua, 68), // Sagrado corazon
    new Date(year, 5, 29), // San Pedro y San Pablo
    new Date(year, 7, 15), // Asuncion de la virgen
    new Date(year, 9, 12), // Dia de la raza
    new Date(year, 10, 1), // Todos los santos
    new Date(year, 10, 11), // Independencia de Cartagena
  ].map(moverALunes_);

  const set = new Set();
  fijos.concat(trasladables).forEach((d) => set.add(formatoFecha_(d)));
  return set;
}
const cacheFestivos_ = {};
function esFestivoColombia(fechaStr) {
  const year = Number(fechaStr.slice(0, 4));
  if (!cacheFestivos_[year]) cacheFestivos_[year] = festivosColombia_(year);
  return cacheFestivos_[year].has(fechaStr);
}

// ---------- Horario segun el tipo de dia ----------
//
// Laboral (lunes a viernes, no festivo): 7:00am-5:00pm con 1h de almuerzo
// sin pagar (12-1pm) = 9 horas normales. Extra desde las 5:00pm.
// Sabado o festivo (cualquier dia de la semana que sea festivo): 7:00am a
// 1:00pm = 6 horas normales, se paga el dia completo igual. Extra desde
// la 1:00pm.
function tipoDia(fechaStr) {
  if (esFestivoColombia(fechaStr)) return "festivo";
  const dow = new Date(fechaStr + "T00:00:00").getDay(); // 0=domingo..6=sabado
  if (dow === 0) return "domingo";
  if (dow === 6) return "sabado";
  return "laboral";
}

function horarioDe_(tipo) {
  if (tipo === "laboral") return { horasNormales: 9, horaCorte: 17 };
  return { horasNormales: 6, horaCorte: 13 }; // sabado, festivo y domingo (no programado)
}

const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function nombreDiaSemana(fechaStr) {
  return NOMBRES_DIA[new Date(fechaStr + "T00:00:00").getDay()];
}

function horaADecimal_(hhmmss) {
  const partes = String(hhmmss || "0:0:0").split(":").map(Number);
  return (partes[0] || 0) + (partes[1] || 0) / 60 + (partes[2] || 0) / 3600;
}

function minHora_(horas) { return horas.reduce((a, b) => (b < a ? b : a)); }
function maxHora_(horas) { return horas.reduce((a, b) => (b > a ? b : a)); }
function agruparPorTrabajadorYFecha_(registros) {
  const grupos = {};
  registros.forEach((r) => {
    const key = r.trabajador + "||" + r.fecha;
    if (!grupos[key]) grupos[key] = { trabajador: r.trabajador, fecha: r.fecha, entradas: [], salidas: [] };
    if (r.tipo === "Entrada") grupos[key].entradas.push(r.hora);
    else if (r.tipo === "Salida") grupos[key].salidas.push(r.hora);
  });
  return grupos;
}

// Calcula la liquidacion para los trabajadores seleccionados en el rango
// [desde, hasta]. Si algun dia tiene entrada sin salida (o viceversa),
// devuelve { ok:false, incompletos } sin calcular nada, para que el usuario
// complete el registro manual y vuelva a pedir la liquidacion.
function calcularLiquidacion({ trabajadores, registros, desde, hasta, seleccion }) {
  const valorPorNombre = {};
  trabajadores.forEach((t) => { valorPorNombre[t.nombre] = Number(t.valorSemanal) || 0; });

  const registrosFiltrados = registros.filter((r) => seleccion.includes(r.trabajador));
  const grupos = agruparPorTrabajadorYFecha_(registrosFiltrados);

  const incompletos = [];
  Object.values(grupos).forEach((g) => {
    if (g.entradas.length && !g.salidas.length) {
      incompletos.push({ trabajador: g.trabajador, fecha: g.fecha, falta: "salida" });
    } else if (!g.entradas.length && g.salidas.length) {
      incompletos.push({ trabajador: g.trabajador, fecha: g.fecha, falta: "entrada" });
    }
  });
  if (incompletos.length) {
    incompletos.sort((a, b) => (a.fecha + a.trabajador) < (b.fecha + b.trabajador) ? -1 : 1);
    return { ok: false, incompletos };
  }
  const porTrabajador = {};
  seleccion.forEach((nombre) => {
    porTrabajador[nombre] = {
      nombre, valorSemanal: valorPorNombre[nombre] || 0, dias: [],
      totalDiasTrabajados: 0, totalValorDias: 0, totalDescuentos: 0, totalHorasExtra: 0, totalValorExtra: 0, totalPagar: 0,
    };
  });

  Object.values(grupos).forEach((g) => {
    if (!g.entradas.length || !g.salidas.length) return;
    const t = porTrabajador[g.trabajador];
    if (!t) return;

    const valorDia = Math.round((t.valorSemanal / 6) * 100) / 100;
    const tipo = tipoDia(g.fecha);
    const { horasNormales, horaCorte } = horarioDe_(tipo);

    const horaEntradaTexto = minHora_(g.entradas);
    const horaSalidaTexto = maxHora_(g.salidas);
    const horaEntradaDec = horaADecimal_(horaEntradaTexto);
    const horaSalidaDec = horaADecimal_(horaSalidaTexto);

    const valorHoraBase = horasNormales > 0 ? valorDia / horasNormales : 0;

    // Llegada tarde: se descuenta proporcionalmente desde las 7:00am.
    const retrasoMin = Math.max(0, Math.round((horaEntradaDec - 7) * 60));
    const descuentoRetraso = Math.round((retrasoMin / 60) * valorHoraBase * 100) / 100;

    // Salida antes de la hora de corte: se descuenta proporcionalmente.
    // Si sale despues de la hora de corte, en cambio, se le paga como hora extra.
    const salidaTempranoMin = Math.max(0, Math.round((horaCorte - horaSalidaDec) * 60));
    const descuentoSalidaTemprano = Math.round((salidaTempranoMin / 60) * valorHoraBase * 100) / 100;
    const horasExtra = Math.max(0, Math.round((horaSalidaDec - horaCorte) * 100) / 100);
    const valorExtra = Math.round(horasExtra * valorHoraBase * 100) / 100;

    const descuentoTotal = Math.round((descuentoRetraso + descuentoSalidaTemprano) * 100) / 100;
    const valorNeto = Math.round((Math.max(0, valorDia - descuentoTotal) + valorExtra) * 100) / 100;
    t.dias.push({
      fecha: g.fecha, diaSemana: nombreDiaSemana(g.fecha), tipoDia: tipo,
      horaEntrada: horaEntradaTexto, horaSalida: horaSalidaTexto,
      valorDia, retrasoMin, descuentoRetraso, salidaTempranoMin, descuentoSalidaTemprano,
      descuentoTotal, horasExtra, valorExtra, valorNeto,
    });
    t.totalDiasTrabajados += 1;
    t.totalValorDias += valorDia;
    t.totalDescuentos += descuentoTotal;
    t.totalHorasExtra += horasExtra;
    t.totalValorExtra += valorExtra;
    t.totalPagar += valorNeto;
  });

  Object.values(porTrabajador).forEach((t) => {
    t.dias.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    t.totalValorDias = Math.round(t.totalValorDias * 100) / 100;
    t.totalDescuentos = Math.round(t.totalDescuentos * 100) / 100;
    t.totalValorExtra = Math.round(t.totalValorExtra * 100) / 100;
    t.totalPagar = Math.round(t.totalPagar * 100) / 100;
  });

  const resultado = seleccion.map((nombre) => porTrabajador[nombre]).filter(Boolean);
  const granTotal = Math.round(resultado.reduce((s, t) => s + t.totalPagar, 0) * 100) / 100;
  return { ok: true, desde, hasta, trabajadores: resultado, granTotal };
}

module.exports = { calcularLiquidacion, esFestivoColombia, tipoDia, nombreDiaSemana };
