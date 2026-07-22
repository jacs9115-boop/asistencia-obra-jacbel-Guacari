require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { calcularLiquidacion } = require("./liquidacion");
const { generarPDFLiquidacion } = require("./liquidacionPdf");

const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(require("path").join(__dirname, "..", "frontend")));

const upload = multer({ limits: { fileSize: 12 * 1024 * 1024 } });

function requireAppsScriptUrl() {
  if (!APPS_SCRIPT_URL) throw new Error("Falta APPS_SCRIPT_URL");
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/trabajadores", async (req, res) => {
  try {
    requireAppsScriptUrl();
    const scriptRes = await fetch(`${APPS_SCRIPT_URL}?trabajadores=1`);
    const data = await scriptRes.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.get("/api/registros", async (req, res) => {
  try {
    requireAppsScriptUrl();
    const scriptRes = await fetch(APPS_SCRIPT_URL);
    const data = await scriptRes.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});
app.post("/api/marcar", upload.single("foto"), async (req, res) => {
  try {
    requireAppsScriptUrl();
    const { trabajador, tipo, lat, lng } = req.body;
    if (!trabajador || !req.file) {
      return res.status(400).json({ error: "Falta el trabajador o la foto" });
    }
    const base64Image = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";
    const extension = mediaType.includes("png") ? "png" : "jpg";
    const fotoNombre = `${trabajador}_${tipo}_${Date.now()}.${extension}`.replace(/[^a-zA-Z0-9._-]+/g, "_");

    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "marcar", trabajador, tipo, lat: lat || "", lng: lng || "",
        fotoBase64: base64Image, fotoMimeType: mediaType, fotoNombre,
      }),
    });
    const scriptData = await scriptRes.json();
    if (!scriptData.ok) {
      return res.status(502).json({ error: scriptData.error || "Error al guardar el registro" });
    }
    res.json(scriptData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});
app.post("/api/marcar-manual", async (req, res) => {
  try {
    requireAppsScriptUrl();
    const { trabajador, tipo, fecha, hora, pin } = req.body;
    if (!trabajador || !fecha || !hora) {
      return res.status(400).json({ error: "Falta el trabajador, la fecha o la hora" });
    }
    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "marcar_manual", trabajador, tipo, fecha, hora, pin: pin || "" }),
    });
    const scriptData = await scriptRes.json();
    if (!scriptData.ok) {
      return res.status(400).json({ error: scriptData.error || "Error al guardar el registro" });
    }
    res.json(scriptData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.post("/api/trabajadores", async (req, res) => {
  try {
    requireAppsScriptUrl();
    const { nombre, valorSemanal, pin } = req.body;
    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "agregar_trabajador", nombre, valorSemanal, pin }),
    });
    const data = await scriptRes.json();
    if (!data.ok) return res.status(400).json({ error: data.error || "Error al agregar" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});
app.post("/api/trabajadores/:nombre/valor", async (req, res) => {
  try {
    requireAppsScriptUrl();
    const { valorSemanal, pin } = req.body;
    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "editar_valor_trabajador", nombre: req.params.nombre, valorSemanal, pin }),
    });
    const data = await scriptRes.json();
    if (!data.ok) return res.status(400).json({ error: data.error || "Error al actualizar el valor" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});

app.delete("/api/trabajadores/:nombre", async (req, res) => {
  try {
    requireAppsScriptUrl();
    const { pin } = req.body;
    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "quitar_trabajador", nombre: req.params.nombre, pin }),
    });
    const data = await scriptRes.json();
    if (!data.ok) return res.status(400).json({ error: data.error || "Error al quitar" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
});
app.post("/api/liquidacion", async (req, res) => {
  try {
    requireAppsScriptUrl();
    const { desde, hasta, seleccion } = req.body;
    if (!desde || !hasta || !Array.isArray(seleccion) || !seleccion.length) {
      return res.status(400).json({ error: "Falta la fecha desde, hasta, o no seleccionaste trabajadores" });
    }

    const [trabajadoresRes, registrosRes] = await Promise.all([
      fetch(`${APPS_SCRIPT_URL}?trabajadores=1`).then((r) => r.json()),
      fetch(`${APPS_SCRIPT_URL}?registrosRango=1&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`).then((r) => r.json()),
    ]);
    if (!Array.isArray(trabajadoresRes) || !Array.isArray(registrosRes)) {
      return res.status(502).json({ error: "No se pudo leer la información de Apps Script" });
    }

    const resultado = calcularLiquidacion({ trabajadores: trabajadoresRes, registros: registrosRes, desde, hasta, seleccion });
    if (!resultado.ok) {
      return res.status(409).json({ error: "Hay registros incompletos", incompletos: resultado.incompletos });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=liquidacion-${desde}-a-${hasta}.pdf`);
    generarPDFLiquidacion(res, resultado);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error inesperado" });
    }
  }
});

app.listen(PORT, () => console.log(`Asistencia Obra escuchando en puerto ${PORT}`));
