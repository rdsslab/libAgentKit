/**
 * Artifacts suite (hermetic).
 *
 * The `create_file` contract is a contract, not an implementation: the host
 * injects the renderers. These tests check both halves of that promise:
 *
 *   - text formats (text, json, csv, markdown, html) never need a renderer
 *   - pdf/image need one, and say so clearly when it is missing
 *   - the injected renderer receives the rendered HTML (title included) and its
 *     buffer comes back untouched
 */

import assert from "node:assert/strict";

import {
	ARTIFACT_FORMATS,
	artifactHtml,
	buildArtifact,
	createFileTool,
	looksLikeHtml,
	safeFileName,
} from "../../src/index.js";

const checks = {};
const check = async (name, fn) => {
	await fn();
	checks[name] = true;
};

const main = async () => {
	await check("formats", () => {
		assert.deepEqual(
			[...ARTIFACT_FORMATS].sort(),
			["csv", "html", "image", "json", "markdown", "pdf", "text"],
		);
	});

	await check("safeFileName", () => {
		assert.equal(safeFileName("informe anual 2026"), "informe_anual_2026");
		assert.equal(safeFileName("../../etc/passwd"), ".._.._etc_passwd");
		assert.equal(safeFileName(""), "archivo");
		assert.equal(safeFileName("  ", "respaldo"), "respaldo");
		assert.ok(safeFileName("a".repeat(200)).length <= 80);
		// "." and ".." would escape the target directory when joined with it.
		assert.equal(safeFileName(".."), "archivo");
		assert.equal(safeFileName("."), "archivo");
		assert.equal(safeFileName("...", "respaldo"), "respaldo");
	});

	await check("looksLikeHtml", () => {
		assert.equal(looksLikeHtml("<!doctype html><html></html>"), true);
		assert.equal(looksLikeHtml("<h1>Hola</h1>"), true);
		assert.equal(looksLikeHtml("Hola, esto es texto"), false);
		assert.equal(looksLikeHtml("const x = 1;"), false);
	});

	await check("artifactHtml escapes", () => {
		const html = artifactHtml("<script>alert(1)</script>", "Titulo & More");
		assert.ok(!html.includes("<script>"), "the content must be escaped");
		assert.ok(html.includes("&#60;script&#62;"), "the content must be escaped as entities");
		assert.ok(html.includes("<h1>Titulo &#38; More</h1>"), "the title must be escaped");
	});

	await check("artifactHtml keeps html", () => {
		const source = "<html><body><p>ya es html</p></body></html>";
		const html = artifactHtml(source, "Mi titulo");
		assert.ok(html.includes("<p>ya es html</p>"));
		assert.ok(html.includes("<h1>Mi titulo</h1>"));
	});

	await check("text formats", async () => {
		const text = await buildArtifact({ format: "text", content: "hola", filename: "nota" });
		assert.equal(text.filename, "nota.txt");
		assert.equal(text.mime, "text/plain");
		assert.equal(text.buffer.toString("utf8"), "hola");

		const csv = await buildArtifact({ format: "csv", content: "a,b\n1,2" });
		assert.equal(csv.filename.endsWith(".csv"), true);
		assert.equal(csv.mime, "text/csv");

		const md = await buildArtifact({ format: "markdown", content: "# hola" });
		assert.equal(md.filename.endsWith(".md"), true);
		assert.equal(md.mime, "text/markdown");
	});

	await check("json keeps valid payloads", async () => {
		const valid = await buildArtifact({ format: "json", content: '{"a":1}' });
		assert.equal(valid.mime, "application/json");
		assert.equal(valid.buffer.toString("utf8"), '{"a":1}');

		const broken = await buildArtifact({ format: "json", content: "no soy json" });
		assert.equal(broken.mime, "application/json");
		assert.deepEqual(JSON.parse(broken.buffer.toString("utf8")), { content: "no soy json" });
	});

	await check("html format", async () => {
		const plain = await buildArtifact({ format: "html", content: "texto", title: "T" });
		assert.equal(plain.mime, "text/html");
		assert.ok(plain.buffer.toString("utf8").includes("<h1>T</h1>"));

		const already = await buildArtifact({ format: "html", content: "<p>x</p>" });
		assert.equal(already.buffer.toString("utf8"), "<p>x</p>");
	});

	await check("empty content is rejected", async () => {
		const result = await buildArtifact({ format: "text", content: "   " });
		assert.ok(result.error);
		assert.equal(result.code, "ARTIFACT_EMPTY");
	});

	await check("content is truncated", async () => {
		const result = await buildArtifact({ format: "text", content: "a".repeat(100), maxChars: 10 });
		assert.ok(result.buffer.toString("utf8").startsWith("aaaaaaaaaa"));
		assert.ok(result.buffer.toString("utf8").includes("truncado"));
	});

	await check("missing renderer is reported", async () => {
		const pdf = await buildArtifact({ format: "pdf", content: "texto" });
		assert.ok(pdf.error);
		assert.equal(pdf.code, "ARTIFACT_RENDERER_UNAVAILABLE");

		const image = await buildArtifact({ format: "image", content: "texto" });
		assert.ok(image.error);
		assert.equal(image.code, "ARTIFACT_RENDERER_UNAVAILABLE");
	});

	await check("injected renderer is used", async () => {
		const seen = [];
		const pdf = await buildArtifact(
			{ format: "pdf", content: "contenido", title: "Reporte" },
			{
				renderPdf: async (html, meta) => {
					seen.push({ html, meta });
					return Buffer.from("%PDF-falso");
				},
			},
		);
		assert.equal(pdf.filename.endsWith(".pdf"), true);
		assert.equal(pdf.mime, "application/pdf");
		assert.equal(pdf.buffer.toString("utf8"), "%PDF-falso");
		assert.ok(seen[0].html.includes("<h1>Reporte</h1>"));
		assert.ok(seen[0].meta.filename.endsWith(".pdf"));

		const image = await buildArtifact(
			{ format: "image", content: "contenido", image_type: "jpeg" },
			{ renderImage: async () => Buffer.from([1, 2, 3]) },
		);
		assert.equal(image.filename.endsWith(".jpg"), true);
		assert.equal(image.mime, "image/jpeg");
		assert.equal(image.buffer.length, 3);
	});

	await check("renderer failure is reported", async () => {
		const result = await buildArtifact(
			{ format: "pdf", content: "contenido" },
			{
				renderPdf: async () => {
					throw new Error("chromium died");
				},
			},
		);
		assert.ok(result.error);
		assert.ok(result.error.includes("chromium died"));
		assert.equal(result.code, "ARTIFACT_RENDER_FAILED");
	});

	await check("tool contract", async () => {
		const tool = createFileTool();
		assert.equal(tool.name, "create_file");
		assert.ok(tool.description.includes("pdf"));
		assert.deepEqual(tool.parameters.required, ["format", "content"]);
		assert.equal(tool.parameters.properties.format.enum.includes("markdown"), true);

		const ok = await tool.handler({ format: "text", content: "hola", filename: "salida" });
		assert.equal(ok.ok, true);
		assert.equal(ok.file, "salida.txt");
		assert.equal(ok.mime, "text/plain");
		assert.equal(ok.bytes, 4);
		assert.ok(ok.artifact.buffer);

		const failed = await tool.handler({ format: "pdf", content: "hola" });
		assert.equal(failed.ok, false);
		assert.equal(failed.code, "ARTIFACT_RENDERER_UNAVAILABLE");
	});

	console.log(JSON.stringify({ ok: true, checks }, null, 2));
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
