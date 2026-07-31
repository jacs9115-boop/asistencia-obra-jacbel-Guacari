const {
  tipoDia, horarioDe_, horaADecimal_, minHora_, maxHora_, agruparPorTrabajadorYFecha_,
} = require("./liquidacion");

// Cuantas veces al mes se paga segun la frecuencia elegida, para poder
// mostrar "cuanto vale el trabajador por mes" sin importar como se le pague.
const MULTIPLICADOR_MENSUAL = { semana: 4.33, catorcenal: 2.14, quincenal: 2, mes: 1 };

function salarioMensualizado(salario, frecuenciaPago) {
  const mult = MULTIPLICADOR_MENSUAL[frecuenciaPago] || 1;
  return Math.round((Number(salario) || 0) * mult * 100) / 100;
}

// El valor de la hora extra "sugerido" es el mismo valorHoraBase que ya usa
// la Liquidacion para un dia laboral (valorSemanal/6 dividido en 9 horas),
// para que el numero por defecto coincida con lo que ya se liquida hoy.
function valorHoraExtraSugerido(valorSemanal) {
  const valorDia = (Number(valorSemanal) || 0) / 6;
  const { horasNormales } = horarioDe_("laboral");
  return Math.round((valorDia / horasNormales) * 100) / 100;
}

// Recorre, dia por dia, los registros de UN trabajador dentro del mes
// [mesYYYYMM] con la misma logica exacta que calcularLiquidacion (tipo de
// dia, horario, retrasos, salida temprano, horas extra), pero separando las
// horas extra (sin valorar) de los descuentos (ya valorados en pesos con el
// valorSemanal, igual que hoy en la Liquidacion). Los dias con entrada sin
// salida (o viceversa) simplemente se omiten: la nomina es un estimado
// mensual, no una liquidacion formal que exija registros completos.
function calcularHorasExtraYDescuentosDelMes(nombreTrabajador, registros, mesYYYYMM, valorSemanal) {
  const valorDia = (Number(valorSemanal) || 0) / 6;
  const registrosDelTrabajador = registros.filter(
    (r) => r.trabajador === nombreTrabajador && r.fecha.slice(0, 7) === mesYYYYMM
  );
  const grupos = agruparPorTrabajadorYFecha_(registrosDelTrabajador);

  let horasExtra = 0;
  let descuentos = 0;
  Object.values(grupos).forEach((g) => {
    if (!g.entradas.length || !g.salidas.length) return;

    const tipo = tipoDia(g.fecha);
    const { horasNormales, horaCorte } = horarioDe_(tipo);
    const horaEntradaDec = horaADecimal_(minHora_(g.entradas));
    const horaSalidaDec = horaADecimal_(maxHora_(g.salidas));
    const valorHoraBase = horasNormales > 0 ? valorDia / horasNormales : 0;

    const retrasoMin = Math.max(0, Math.round((horaEntradaDec - 7) * 60));
    const descuentoRetraso = (retrasoMin / 60) * valorHoraBase;

    const salidaTempranoMin = Math.max(0, Math.round((horaCorte - horaSalidaDec) * 60));
    const descuentoSalidaTemprano = (salidaTempranoMin / 60) * valorHoraBase;

    horasExtra += Math.max(0, Math.round((horaSalidaDec - horaCorte) * 100) / 100);
    descuentos += descuentoRetraso + descuentoSalidaTemprano;
  });

  return {
    horasExtra: Math.round(horasExtra * 100) / 100,
    descuentos: Math.round(descuentos * 100) / 100,
  };
}

// Arma el objeto completo de nomina de un trabajador para el mes actual,
// listo para mostrar en la app y para sincronizar con el Google Sheet.
function calcularNominaTrabajador(trabajador, registros, mesYYYYMM) {
  const salarioMensual = salarioMensualizado(trabajador.salario, trabajador.frecuenciaPago);
  const { horasExtra, descuentos } = calcularHorasExtraYDescuentosDelMes(
    trabajador.nombre, registros, mesYYYYMM, trabajador.valorSemanal
  );
  const valorHoraExtra = Number(trabajador.valorHoraExtra) || 0;
  const valorHorasExtra = Math.round(horasExtra * valorHoraExtra * 100) / 100;
  const auxilioTransporte = trabajador.tieneAuxilioTransporte ? (Number(trabajador.valorAuxilioTransporte) || 0) : 0;
  const salud = Math.round(salarioMensual * ((Number(trabajador.pctSalud) || 0) / 100) * 100) / 100;
  const pension = Math.round(salarioMensual * ((Number(trabajador.pctPension) || 0) / 100) * 100) / 100;
  const total = Math.round((salarioMensual + valorHorasExtra + auxilioTransporte + salud + pension - descuentos) * 100) / 100;

  return {
    nombre: trabajador.nombre,
    cargo: trabajador.cargo || "",
    frecuenciaPago: trabajador.frecuenciaPago || "",
    salario: Number(trabajador.salario) || 0,
    salarioMensual,
    tieneAuxilioTransporte: !!trabajador.tieneAuxilioTransporte,
    valorAuxilioTransporte: auxilioTransporte,
    valorHoraExtra,
    horasExtra,
    valorHorasExtra,
    descuentos,
    pctSalud: Number(trabajador.pctSalud) || 0,
    pctPension: Number(trabajador.pctPension) || 0,
    salud,
    pension,
    total,
  };
}

module.exports = {
  MULTIPLICADOR_MENSUAL, salarioMensualizado, valorHoraExtraSugerido,
  calcularHorasExtraYDescuentosDelMes, calcularNominaTrabajador,
};

