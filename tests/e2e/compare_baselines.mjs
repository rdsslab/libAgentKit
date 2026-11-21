/**
 * Compara los resultados canónicos actuales contra los baselines conservados.
 *
 * Uso:
 *   node tests/e2e/compare_baselines.mjs
 *   node tests/e2e/compare_baselines.mjs --score-tolerance=3 --check-duration
 *
 * No modifica artefactos: imprime una tabla y escribe RESUMEN_COMPARACION.md.
 * Sale con código 1 si hay regresiones (booleano que pasa a false o bajada de
 * puntuación por encima de la tolerancia).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(SCRIPT_DIR, "resultados_por_modelo");
const BASELINE_SUFFIX = "_baseline_pre_rerun";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const found = args.find((arg) => arg.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
  };
  return {
    scoreTolerance: Number(get("score-tolerance", "5")),
    durationFactor: Number(get("duration-factor", "1.25")),
    checkDuration: args.includes("--check-duration"),
  };
};

const METRICS = [
  ["P01 ok", "pruebas.p01.exito"],
  ["P01 ms", "pruebas.p01.duracionMs"],
  ["P02 IP", "pruebas.p02.ip.exito"],
  ["P02 web", "pruebas.p02.web.exito"],
  ["P03 ok", "pruebas.p03.exito"],
  ["P04 compacta", "pruebas.p04.compactionTriggered"],
  ["P05 calidad", "pruebas.p05.puntuacionMedia"],
  ["P05 funcional", "pruebas.p05.funcionalMedia"],
  ["P06 calidad", "pruebas.p06.puntuacionMedia"],
  ["P06 funcional", "pruebas.p06.funcional.puntuacion"],
  ["quality", "pruebas.p05_enhanced.calidad.puntuacion"],
  ["quality funcional", "pruebas.p05_enhanced.funcional.puntuacion"],
  ["idioma es/code", "pruebas.idioma.es.code.calidad.puntuacion"],
  ["idioma en/code", "pruebas.idioma.en.code.calidad.puntuacion"],
  ["idioma es/web", "pruebas.idioma.es.web.calidad.puntuacion"],
  ["idioma en/web", "pruebas.idioma.en.web.calidad.puntuacion"],
];

const getByPath = (object, dotted) => dotted.split(".").reduce(
  (value, key) => (value == null ? undefined : value[key]),
  object,
);

const fmt = (value) => {
  if (value == null || Number.isNaN(value)) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  return String(value).slice(0, 40);
};

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function compareValue(label, before, after, options) {
  if (before == null || after == null) {
    return { label, before, after, status: "sin datos" };
  }
  if (typeof before === "boolean" || typeof after === "boolean") {
    const status = before === true && after !== true ? "REGRESIÓN" : (after && !before ? "MEJORA" : "igual");
    return { label, before, after, status };
  }
  if (typeof before === "number" && typeof after === "number") {
    const esTiempo = /ms$/i.test(label) || /duracion/i.test(label);
    const delta = after - before;
    if (esTiempo) {
      const status = options.checkDuration && delta > before * (options.durationFactor - 1)
        ? "REGRESIÓN"
        : "informativo";
      return { label, before, after, delta, status };
    }
    const status = delta < -options.scoreTolerance
      ? "REGRESIÓN"
      : delta > options.scoreTolerance ? "MEJORA" : "igual";
    return { label, before, after, delta, status };
  }
  return { label, before, after, status: "informativo" };
}

async function main() {
  const options = parseArgs();
  const allNames = new Set(
    (await fs.readdir(RESULTS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const entries = [...allNames]
    .filter((name) => name.startsWith("canonico_")
      && !name.endsWith(BASELINE_SUFFIX)
      && allNames.has(`${name}${BASELINE_SUFFIX}`))
    .sort();

  const lines = [
    "# Comparación con baselines",
    "",
    `- Tolerancia de puntuación: ${options.scoreTolerance} puntos`,
    `- Factor de duración: ${options.durationFactor} (${options.checkDuration ? "activado" : "solo informativo"})`,
    "",
  ];
  let regresiones = 0;

  for (const name of entries) {
    const actual = await readJson(path.join(RESULTS_DIR, name, "resultados.json"));
    const base = await readJson(path.join(RESULTS_DIR, `${name}${BASELINE_SUFFIX}`, "resultados.json"));
    if (!actual || !base) continue;

    const filas = METRICS.map(([label, key]) => compareValue(label, getByPath(base, key), getByPath(actual, key), options))
      .filter((fila) => fila.status !== "sin datos");
    const regresadas = filas.filter((fila) => fila.status === "REGRESIÓN");
    regresiones += regresadas.length;

    lines.push(`## ${name}`, "", "| Métrica | Antes | Ahora | Δ | Estado |", "|---|---|---|---|---|");
    for (const fila of filas) {
      const delta = fila.delta == null ? "" : (fila.delta > 0 ? `+${Math.round(fila.delta)}` : String(Math.round(fila.delta)));
      lines.push(`| ${fila.label} | ${fmt(fila.before)} | ${fmt(fila.after)} | ${delta} | ${fila.status} |`);
    }
    lines.push("");
    console.log(`${name}: ${filas.length} métricas, ${regresadas.length} regresiones`);
  }

  if (entries.length === 0) {
    lines.push("_No hay pares actual/baseline disponibles._", "");
    console.log("No hay pares actual/baseline disponibles.");
  }

  const reportPath = path.join(SCRIPT_DIR, "RESUMEN_COMPARACION.md");
  await fs.writeFile(reportPath, `${lines.join("\n")}\n`);
  console.log(`Informe: ${path.relative(process.cwd(), reportPath)}`);
  if (regresiones > 0) {
    console.error(`${regresiones} regresiones detectadas.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exitCode = 1;
});
