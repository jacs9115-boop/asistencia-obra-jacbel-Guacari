require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { calcularLiquidacion } = require("./liquidacion");
const { generarPDFLiquidacion } = require("./liquidacionPdf");

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

const upload = multer({ limits: { fileSize: 12 * 1024 * 1024 } });

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Falta configurar SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY");
  }
}

// ---------- Cliente REST de Supabase via fetch (sin dependencias nuevas) ----------

async function sbFetch(pathAndQuery, options = {}) {
  requireSupabaseConfig();
  const res = await fetch(`${SUPABASE_URL}${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return res;
}

async function sbSelect(table, query) {
  const res = await sbFetch(`/rest/v1/${table}?${query}`);
  if (!res.ok) throw new Error(`Error consultando ${table}: ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, rows) {
  const res = await sbFetch(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Error insertando en ${table}: ${await res.text()}`);
  return res.json();
}

async function sbUpdate(table, query, patch) {
  const res = await sbFetch(`/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Error actualizando ${table}: ${await res.text()}`);
  return res.json();
}

// ---------- Autenticacion (Supabase Auth via REST) ----------

async function loginConEmailYPassword(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Correo o contraseña incorrectos");
  return data;
}

async function usuarioDesdeToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function crearUsuarioAuth({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || "No se pudo crear el usuario");
  return data;
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "No autenticado" });
    const authUser = await usuarioDesdeToken(token);
    if (!authUser || !authUser.id) return res.status(401).json({ error: "Sesión inválida, vuelve a iniciar sesión" });
    const perfiles = await sbSelect("perfiles", `id=eq.${authUser.id}&select=*`);
    const perfil = perfiles[0];
    if (!perfil) return res.status(403).json({ error: "Tu usuario no tiene un perfil configurado. Contacta al administrador." });
    if (!perfil.activo) return res.status(403).json({ error: "Tu cuenta está inactiva. Contacta al administrador." });
    req.perfil = perfil;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error de autenticación" });
  }
}

function requireAdmin(req, res, next) {
  if (req.perfil.rol !== "admin") return res.status(403).json({ error: "Solo el administrador puede hacer esto" });
  next();
}

// ---------- PIN de seguridad (hash con scrypt nativo, sin dependencias) ----------

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pin), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verificarPin(pin, almacenado) {
  if (!almacenado || !pin) return false;
  const [salt, hash] = almacenado.split(":");
  if (!salt || !hash) return false;
  const hashGuardado = Buffer.from(hash, "hex");
  const hashIngresado = crypto.scryptSync(String(pin), salt, 64);
  return hashGuardado.length === hashIngresado.length && crypto.timingSafeEqual(hashGuardado, hashIngresado);
}

async function requierePin(req, res, next) {
  try {
    if (req.perfil.rol === "admin") return next();
    const pin = (req.body.pin || "").trim();
    if (!req.perfil.pin_seguridad_hash) {
      return res.status(400).json({ error: "Todavía no has configurado tu PIN de seguridad. Ve a Ajustes para crearlo." });
    }
    if (!verificarPin(pin, req.perfil.pin_seguridad_hash)) {
      return res.status(403).json({ error: "PIN incorrecto" });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error verificando el PIN" });
  }
}

// ---------- Auditoria y notificaciones ----------

async function registrarAuditoria({ tabla, registroId, accion, usuarioId, antes, despues, requirioPin }) {
  try {
    await sbInsert("auditoria", [{
      tabla, registro_id: registroId, accion, usuario_id: usuarioId,
      valores_antes: antes || null, valores_despues: despues || null, requirio_pin: !!requirioPin,
    }]);
  } catch (err) {
    console.error("No se pudo registrar auditoria:", err.message);
  }
}

async function crearNotificacion({ contratistaId, obraId, tipo, mensaje }) {
  try {
    await sbInsert("notificaciones", [{ contratista_id: contratistaId, obra_id: obraId, tipo, mensaje }]);
  } catch (err) {
    console.error("No se pudo crear notificacion:", err.message);
  }
}

// ---------- Fecha/hora Colombia (UTC-5 fijo, sin horario de verano) ----------

function ahoraColombia_() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000);
}

function fechaColombiaTexto_(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function horaColombiaTexto_(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ---------- Sincronizacion opcional con Google Sheets (solo obras que lo configuren) ----------

async function sincronizarConSheets_(obraId, datos) {
  try {
    const obraRows = await sbSelect("obras", `id=eq.${obraId}&select=sheets_webapp_url,sheets_secret`);
    const obra = obraRows[0];
    if (!obra || !obra.sheets_webapp_url) return;
    await fetch(obra.sheets_webapp_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "sync_registro", secreto: obra.sheets_secret, ...datos }),
    });
  } catch (err) {
    console.error("No se pudo sincronizar con Google Sheets:", err.message);
  }
}

// ---------- Obra: pertenencia ----------

async function obraPerteneceA_(obraId, perfil) {
  if (perfil.rol === "admin") return true;
  const rows = await sbSelect("obras", `id=eq.${obraId}&contratista_id=eq.${perfil.id}&select=id`);
  return rows.length > 0;
}

async function cargarObra(req, res, next) {
  try {
    const ok = await obraPerteneceA_(req.params.obraId, req.perfil);
    if (!ok) return res.status(403).json({ error: "No tienes acceso a esta obra" });
    req.obraId = req.params.obraId;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error verificando la obra" });
  }
}

// ================= Rutas =================

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Falta correo o contraseña" });
    const data = await loginConEmailYPassword(email, password);
    const perfiles = await sbSelect("perfiles", `id=eq.${data.user.id}&select=*`);
    const perfil = perfiles[0];
    if (!perfil) return res.status(403).json({ error: "Este usuario no tiene un perfil configurado. Contacta al administrador." });
    if (!perfil.activo) return res.status(403).json({ error: "Tu cuenta está inactiva. Contacta al administrador." });
    res.json({ token: data.access_token, perfil });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get("/api/me", requireAuth, (req, res) => res.json(req.perfil));

app.put("/api/perfil/pin", requireAuth, async (req, res) => {
  try {
    const { pinNuevo, pinActual } = req.body;
    if (!/^\d{4,6}$/.test(pinNuevo || "")) return res.status(400).json({ error: "El PIN debe tener entre 4 y 6 dígitos" });
    if (req.perfil.pin_seguridad_hash && !verificarPin(pinActual, req.perfil.pin_seguridad_hash)) {
      return res.status(403).json({ error: "El PIN actual no coincide" });
    }
    await sbUpdate("perfiles", `id=eq.${req.perfil.id}`, { pin_seguridad_hash: hashPin(pinNuevo) });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

// ---------- Obras ----------

app.get("/api/obras", requireAuth, async (req, res) => {
  try {
    const rows = await sbSelect("obras", `contratista_id=eq.${req.perfil.id}&select=*&order=nombre.asc`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.post("/api/obras", requireAuth, async (req, res) => {
  try {
    const nombre = (req.body.nombre || "").trim();
    if (!nombre) return res.status(400).json({ error: "Falta el nombre de la obra" });
    const rows = await sbInsert("obras", [{ contratista_id: req.perfil.id, nombre }]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

// ---------- Trabajadores (por obra) ----------

app.get("/api/obras/:obraId/trabajadores", requireAuth, cargarObra, async (req, res) => {
  try {
    const trabajadores = await sbSelect("trabajadores", `obra_id=eq.${req.obraId}&activo=eq.true&select=*&order=nombre.asc`);
    const hoy = fechaColombiaTexto_(ahoraColombia_());
    const registrosHoy = await sbSelect(
      "registros",
      `obra_id=eq.${req.obraId}&fecha=eq.${hoy}&select=trabajador_id,tipo,hora&order=hora.asc`
    );
    const estados = {};
    registrosHoy.forEach((r) => { estados[r.trabajador_id] = r; });
    res.json(trabajadores.map((t) => {
      const e = estados[t.id];
      return {
        id: t.id, nombre: t.nombre, valorSemanal: Number(t.valor_semanal) || 0,
        enObra: !!e && e.tipo === "entrada", ultimaHora: e ? e.hora : null,
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.post("/api/obras/:obraId/trabajadores", requireAuth, cargarObra, requierePin, async (req, res) => {
  try {
    const nombre = (req.body.nombre || "").trim();
    const valorSemanal = Number(req.body.valorSemanal) || 0;
    if (!nombre) return res.status(400).json({ error: "Falta el nombre" });

    const existentes = await sbSelect("trabajadores", `obra_id=eq.${req.obraId}&nombre=eq.${encodeURIComponent(nombre)}&select=*`);
    let trabajador;
    if (existentes.length) {
      const rows = await sbUpdate("trabajadores", `id=eq.${existentes[0].id}`, { activo: true, valor_semanal: valorSemanal });
      trabajador = rows[0];
    } else {
      const rows = await sbInsert("trabajadores", [{ obra_id: req.obraId, nombre, valor_semanal: valorSemanal }]);
      trabajador = rows[0];
    }

    await registrarAuditoria({
      tabla: "trabajadores", registroId: trabajador.id, accion: "crear",
      usuarioId: req.perfil.id, despues: trabajador, requirioPin: true,
    });
    const obraRows = await sbSelect("obras", `id=eq.${req.obraId}&select=nombre,contratista_id`);
    await crearNotificacion({
      contratistaId: obraRows[0]?.contratista_id, obraId: req.obraId, tipo: "trabajador_agregado",
      mensaje: `Se agregó a "${nombre}" en la obra "${obraRows[0]?.nombre || ""}"`,
    });

    res.json({ ok: true, trabajador });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.put("/api/obras/:obraId/trabajadores/:trabajadorId", requireAuth, cargarObra, requierePin, async (req, res) => {
  try {
    const valorSemanal = Number(req.body.valorSemanal) || 0;
    const antes = await sbSelect("trabajadores", `id=eq.${req.params.trabajadorId}&obra_id=eq.${req.obraId}&select=*`);
    if (!antes.length) return res.status(404).json({ error: "Trabajador no encontrado" });
    const rows = await sbUpdate("trabajadores", `id=eq.${req.params.trabajadorId}`, { valor_semanal: valorSemanal });
    await registrarAuditoria({
      tabla: "trabajadores", registroId: req.params.trabajadorId, accion: "editar",
      usuarioId: req.perfil.id, antes: antes[0], despues: rows[0], requirioPin: true,
    });
    res.json({ ok: true, trabajador: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.delete("/api/obras/:obraId/trabajadores/:trabajadorId", requireAuth, cargarObra, requierePin, async (req, res) => {
  try {
    const antes = await sbSelect("trabajadores", `id=eq.${req.params.trabajadorId}&obra_id=eq.${req.obraId}&select=*`);
    if (!antes.length) return res.status(404).json({ error: "Trabajador no encontrado" });
    await sbUpdate("trabajadores", `id=eq.${req.params.trabajadorId}`, { activo: false, fecha_retiro: fechaColombiaTexto_(ahoraColombia_()) });
    await registrarAuditoria({
      tabla: "trabajadores", registroId: req.params.trabajadorId, accion: "eliminar",
      usuarioId: req.perfil.id, antes: antes[0], requirioPin: true,
    });
    const obraRows = await sbSelect("obras", `id=eq.${req.obraId}&select=nombre,contratista_id`);
    await crearNotificacion({
      contratistaId: obraRows[0]?.contratista_id, obraId: req.obraId, tipo: "trabajador_retirado",
      mensaje: `Se retiró a "${antes[0].nombre}" de la obra "${obraRows[0]?.nombre || ""}"`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

// ---------- Marcar entrada/salida (con foto) ----------

app.post("/api/obras/:obraId/marcar", requireAuth, cargarObra, upload.single("foto"), async (req, res) => {
  try {
    const { trabajadorId, tipo, lat, lng } = req.body;
    if (!trabajadorId || !req.file) return res.status(400).json({ error: "Falta el trabajador o la foto" });
    const tipoFinal = tipo === "Salida" ? "salida" : "entrada";

    const trabajadores = await sbSelect("trabajadores", `id=eq.${trabajadorId}&obra_id=eq.${req.obraId}&select=nombre`);
    if (!trabajadores.length) return res.status(404).json({ error: "Trabajador no encontrado en esta obra" });

    const ahora = ahoraColombia_();
    const extension = (req.file.mimetype || "").includes("png") ? "png" : "jpg";
    const nombreArchivo = `${req.obraId}/${trabajadorId}_${Date.now()}.${extension}`;

    const subida = await sbFetch(`/storage/v1/object/fotos-asistencia/${nombreArchivo}`, {
      method: "POST",
      headers: { "Content-Type": req.file.mimetype || "image/jpeg" },
      body: req.file.buffer,
    });
    if (!subida.ok) throw new Error(`No se pudo subir la foto: ${await subida.text()}`);
    const fotoUrl = `${SUPABASE_URL}/storage/v1/object/public/fotos-asistencia/${nombreArchivo}`;

    const filaRegistro = await sbInsert("registros", [{
      trabajador_id: trabajadorId, obra_id: req.obraId, tipo: tipoFinal,
      fecha: fechaColombiaTexto_(ahora), hora: horaColombiaTexto_(ahora),
      foto_url: fotoUrl, latitud: lat || null, longitud: lng || null,
      es_manual: false, registrado_por: req.perfil.id,
    }]);

    sincronizarConSheets_(req.obraId, {
      trabajador: trabajadores[0].nombre, tipo: tipoFinal === "salida" ? "Salida" : "Entrada",
      fecha: fechaColombiaTexto_(ahora), hora: horaColombiaTexto_(ahora),
      lat: lat || "", lng: lng || "", fotoUrl, origen: "App",
    });

    res.json({ ok: true, trabajador: trabajadores[0].nombre, tipo: tipoFinal === "salida" ? "Salida" : "Entrada", registro: filaRegistro[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.post("/api/obras/:obraId/marcar-manual", requireAuth, cargarObra, requierePin, async (req, res) => {
  try {
    const { trabajadorId, tipo, fecha, hora, motivo } = req.body;
    if (!trabajadorId || !fecha || !hora) return res.status(400).json({ error: "Falta el trabajador, la fecha o la hora" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha inválida" });
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) return res.status(400).json({ error: "Hora inválida" });
    const horaFinal = hora.length === 5 ? `${hora}:00` : hora;
    const tipoFinal = tipo === "Salida" ? "salida" : "entrada";

    const trabajadores = await sbSelect("trabajadores", `id=eq.${trabajadorId}&obra_id=eq.${req.obraId}&select=nombre`);
    if (!trabajadores.length) return res.status(404).json({ error: "Trabajador no encontrado en esta obra" });

    const filaRegistro = await sbInsert("registros", [{
      trabajador_id: trabajadorId, obra_id: req.obraId, tipo: tipoFinal,
      fecha, hora: horaFinal, es_manual: true, motivo_manual: motivo || "", registrado_por: req.perfil.id,
    }]);

    await registrarAuditoria({
      tabla: "registros", registroId: filaRegistro[0].id, accion: "crear",
      usuarioId: req.perfil.id, despues: filaRegistro[0], requirioPin: true,
    });
    const obraRows = await sbSelect("obras", `id=eq.${req.obraId}&select=nombre,contratista_id`);
    await crearNotificacion({
      contratistaId: obraRows[0]?.contratista_id, obraId: req.obraId, tipo: "edicion_manual",
      mensaje: `Registro manual de ${tipoFinal} para "${trabajadores[0].nombre}" el ${fecha} ${horaFinal}${motivo ? " — " + motivo : ""}`,
    });

    sincronizarConSheets_(req.obraId, {
      trabajador: trabajadores[0].nombre, tipo: tipoFinal === "salida" ? "Salida" : "Entrada",
      fecha, hora: horaFinal, lat: "", lng: "", fotoUrl: "", origen: "Manual",
    });

    res.json({ ok: true, trabajador: trabajadores[0].nombre, tipo: tipoFinal === "salida" ? "Salida" : "Entrada", fecha, hora: horaFinal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

// ---------- Registros ----------

app.get("/api/obras/:obraId/registros-hoy", requireAuth, cargarObra, async (req, res) => {
  try {
    const hoy = fechaColombiaTexto_(ahoraColombia_());
    const registros = await sbSelect(
      "registros",
      `obra_id=eq.${req.obraId}&fecha=eq.${hoy}&select=id,tipo,hora,foto_url,es_manual,trabajadores(nombre)&order=hora.desc`
    );
    res.json(registros.map((r) => ({
      trabajador: r.trabajadores?.nombre || "", tipo: r.tipo === "salida" ? "Salida" : "Entrada",
      hora: r.hora, fotoUrl: r.foto_url, origen: r.es_manual ? "Manual" : "App",
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.get("/api/obras/:obraId/registros-rango", requireAuth, cargarObra, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || "") || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || "")) {
      return res.status(400).json({ error: "Falta la fecha desde/hasta" });
    }
    const registros = await sbSelect(
      "registros",
      `obra_id=eq.${req.obraId}&fecha=gte.${desde}&fecha=lte.${hasta}&select=tipo,fecha,hora,trabajadores(nombre)&order=fecha.asc`
    );
    res.json(registros.map((r) => ({
      trabajador: r.trabajadores?.nombre || "", tipo: r.tipo === "salida" ? "Salida" : "Entrada",
      fecha: r.fecha, hora: r.hora,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

// ---------- Liquidacion ----------

app.post("/api/obras/:obraId/liquidacion", requireAuth, cargarObra, async (req, res) => {
  try {
    const { desde, hasta, seleccion } = req.body;
    if (!desde || !hasta || !Array.isArray(seleccion) || !seleccion.length) {
      return res.status(400).json({ error: "Falta la fecha desde, hasta, o no seleccionaste trabajadores" });
    }

    const obraRows = await sbSelect("obras", `id=eq.${req.obraId}&select=nombre`);
    const trabajadores = await sbSelect("trabajadores", `obra_id=eq.${req.obraId}&activo=eq.true&select=nombre,valor_semanal`);
    const registrosRaw = await sbSelect(
      "registros",
      `obra_id=eq.${req.obraId}&fecha=gte.${desde}&fecha=lte.${hasta}&select=tipo,fecha,hora,trabajadores(nombre)`
    );

    const trabajadoresParaCalculo = trabajadores.map((t) => ({ nombre: t.nombre, valorSemanal: Number(t.valor_semanal) || 0 }));
    const registrosParaCalculo = registrosRaw.map((r) => ({
      trabajador: r.trabajadores?.nombre || "", tipo: r.tipo === "salida" ? "Salida" : "Entrada", fecha: r.fecha, hora: r.hora,
    }));

    const resultado = calcularLiquidacion({ trabajadores: trabajadoresParaCalculo, registros: registrosParaCalculo, desde, hasta, seleccion });
    if (!resultado.ok) {
      return res.status(409).json({ error: "Hay registros incompletos", incompletos: resultado.incompletos });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=liquidacion-${desde}-a-${hasta}.pdf`);
    generarPDFLiquidacion(res, resultado, obraRows[0]?.nombre);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

// ---------- Admin: contratistas y notificaciones ----------

app.get("/api/admin/contratistas", requireAuth, requireAdmin, async (req, res) => {
  try {
    const contratistas = await sbSelect("perfiles", `rol=eq.contratista&select=*&order=nombre.asc`);
    const obras = await sbSelect("obras", `select=id,nombre,contratista_id&order=nombre.asc`);
    const trabajadores = await sbSelect("trabajadores", `activo=eq.true&select=id,obra_id`);
    const obrasPorContratista = {};
    obras.forEach((o) => {
      obrasPorContratista[o.contratista_id] = obrasPorContratista[o.contratista_id] || [];
      obrasPorContratista[o.contratista_id].push({ id: o.id, nombre: o.nombre });
    });
    res.json(contratistas.map((c) => {
      const misObras = obrasPorContratista[c.id] || [];
      const idsObras = misObras.map((o) => o.id);
      const numTrabajadores = trabajadores.filter((t) => idsObras.includes(t.obra_id)).length;
      return {
        id: c.id, nombre: c.nombre, plan: c.plan, activo: c.activo,
        obras: misObras, numTrabajadores,
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.post("/api/admin/contratistas", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, password, nombre, plan } = req.body;
    if (!email || !password || !nombre) return res.status(400).json({ error: "Falta correo, contraseña o nombre" });
    const authUser = await crearUsuarioAuth({ email, password });
    const rows = await sbInsert("perfiles", [{
      id: authUser.id, rol: "contratista", nombre, plan: plan === "completo" ? "completo" : "autogestion",
    }]);
    res.json({ ok: true, perfil: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.put("/api/admin/contratistas/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const patch = {};
    if (req.body.plan) patch.plan = req.body.plan;
    if (typeof req.body.activo === "boolean") patch.activo = req.body.activo;
    if (req.body.nombre) patch.nombre = req.body.nombre;
    const rows = await sbUpdate("perfiles", `id=eq.${req.params.id}`, patch);
    res.json({ ok: true, perfil: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.get("/api/admin/notificaciones", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await sbSelect("notificaciones", `select=*,perfiles(nombre),obras(nombre)&order=created_at.desc&limit=200`);
    res.json(rows.map((n) => ({
      id: n.id, tipo: n.tipo, mensaje: n.mensaje, leida: n.leida, fecha: n.created_at,
      contratista: n.perfiles?.nombre || "", obra: n.obras?.nombre || "",
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.put("/api/admin/notificaciones/:id/leida", requireAuth, requireAdmin, async (req, res) => {
  try {
    await sbUpdate("notificaciones", `id=eq.${req.params.id}`, { leida: true });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.listen(PORT, () => console.log(`Asistencia JACBEL SaaS escuchando en puerto ${PORT}`));
