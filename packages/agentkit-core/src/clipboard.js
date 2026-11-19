import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = (cmd, args, opts = {}) => {
	try {
		return spawnSync(cmd, args, { encoding: opts.encoding ?? "utf8", input: opts.input, maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024 });
	} catch (error) {
		return { status: 1, error, stdout: "", stderr: String(error?.message || error) };
	}
};

export const copyTextToClipboard = (text) => {
	const value = String(text ?? "");
	const platform = process.platform;
	const attempts = [];

	if (platform === "darwin") attempts.push(["pbcopy", []]);
	if (platform === "win32") attempts.push(["clip", []]);
	if (platform === "linux") {
		if (process.env.WAYLAND_DISPLAY) attempts.push(["wl-copy", []]);
		attempts.push(["xclip", ["-selection", "clipboard"]]);
		attempts.push(["xsel", ["--clipboard", "--input"]]);
		if (process.env.WAYLAND_DISPLAY) attempts.push(["xclip", ["-selection", "clipboard"]]);
	}

	for (const [cmd, args] of attempts) {
		const res = run(cmd, args, { input: value });
		if (res && res.status === 0) return { ok: true, method: cmd };
	}
	return { ok: false, error: "No clipboard command available" };
};

export const readTextFromClipboard = () => {
	const platform = process.platform;
	const attempts = [];
	if (platform === "darwin") attempts.push(["pbpaste", []]);
	if (platform === "win32") attempts.push(["powershell", ["-NoProfile", "-Command", "Get-Clipboard"]]);
	if (platform === "linux") {
		if (process.env.WAYLAND_DISPLAY) attempts.push(["wl-paste", ["--no-newline"]]);
		attempts.push(["xclip", ["-selection", "clipboard", "-o"]]);
		attempts.push(["xsel", ["--clipboard", "--output"]]);
	}
	for (const [cmd, args] of attempts) {
		const res = run(cmd, args, {});
		if (res && res.status === 0) return { ok: true, text: String(res.stdout ?? "") , method: cmd };
	}
	return { ok: false, error: "No clipboard read command available" };
};

export const readImageFromClipboard = () => {
	const platform = process.platform;
	const tmp = path.join(os.tmpdir(), `agentkit-clipboard-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
	const attempts = [];
	if (platform === "linux") {
		if (process.env.WAYLAND_DISPLAY) attempts.push(["wl-paste", ["--type", "image/png"]]);
		attempts.push(["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]]);
	}
	if (platform === "darwin") {
		attempts.push(["pngpaste", [tmp]]);
	}
	if (platform === "win32") {
		// Best effort: powershell can save image from clipboard
		attempts.push(["powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; if([System.Windows.Forms.Clipboard]::ContainsImage()){ $img=[System.Windows.Forms.Clipboard]::GetImage(); $img.Save('${tmp.replace(/'/g, "''")}'); Write-Output '${tmp.replace(/'/g, "''")}' }`]]);
	}

	for (const [cmd, args] of attempts) {
		if (cmd === "pngpaste" || (platform === "win32" && cmd === "powershell")) {
			const res = run(cmd, args, {});
			if (res && res.status === 0 && fs.existsSync(tmp)) {
				const data = fs.readFileSync(tmp);
				try { fs.unlinkSync(tmp); } catch {}
				if (data && data.length) return { ok: true, data, mimeType: "image/png", method: cmd };
			}
			try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
			continue;
		}
		const res = run(cmd, args, { encoding: "buffer" });
		if (res && res.status === 0 && res.stdout && res.stdout.length > 8) {
			return { ok: true, data: Buffer.from(res.stdout), mimeType: "image/png", method: cmd };
		}
	}
	try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
	return { ok: false, error: "No image clipboard support available" };
};
