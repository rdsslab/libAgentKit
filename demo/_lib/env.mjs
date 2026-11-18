import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const safeExec = async (cmd, args = [], timeout = 5000) => {
	try {
		const { stdout } = await execFileAsync(cmd, args, { timeout, maxBuffer: 256 * 1024 });
		return String(stdout || "").trim();
	} catch {
		return null;
	}
};

let cached = null;

export const getEnvironmentInfo = async () => {
	if (cached) return cached;
	const [osRelease, cpuInfo, memInfo, ollamaVersion, ollamaList, nodeVer, npmVer, gpu, disk] = await Promise.all([
		safeExec("bash", ["-lc", "cat /etc/os-release 2>/dev/null | head -20"]),
		safeExec("bash", ["-lc", "lscpu 2>/dev/null | sed -n '1,40p'"]),
		safeExec("bash", ["-lc", "free -h 2>/dev/null"]),
		safeExec("ollama", ["--version"]),
		safeExec("bash", ["-lc", "ollama list 2>/dev/null | head -40"]),
		safeExec("node", ["-v"]),
		safeExec("npm", ["-v"]),
		safeExec("bash", ["-lc", "lspci 2>/dev/null | grep -i 'vga\\|3d\\|display' || true"]),
		safeExec("bash", ["-lc", "df -h / 2>/dev/null | tail -2"]),
	]);

	const cpuModel = cpuInfo?.match(/Model name:\s*(.+)/)?.[1]?.trim() || os.cpus()?.[0]?.model || null;
	const cpuCores = cpuInfo?.match(/^CPU\(s\):\s*(\d+)/m)?.[1] ? Number(cpuInfo.match(/^CPU\(s\):\s*(\d+)/m)[1]) : os.cpus()?.length || null;

	cached = {
		timestamp: new Date().toISOString(),
		platform: process.platform,
		arch: process.arch,
		kernel: os.release(),
		os: {
			release: osRelease,
			prettyName: osRelease?.match(/PRETTY_NAME=\"?([^\n\"]+)\"?/)?.[1] || null,
		},
		cpu: {
			model: cpuModel,
			cores: cpuCores,
			threadsPerCore: cpuInfo?.match(/Thread\(s\) per core:\s*(\d+)/)?.[1] ? Number(cpuInfo.match(/Thread\(s\) per core:\s*(\d+)/)[1]) : null,
			maxMHz: cpuInfo?.match(/CPU max MHz:\s*([\d,\.]+)/)?.[1] || null,
			lscpu: cpuInfo,
		},
		memory: {
			total: os.totalmem(),
			free: os.freemem(),
			totalHuman: memInfo?.split("\n").find(l => l.startsWith("Mem:")) || null,
			swapHuman: memInfo?.split("\n").find(l => l.startsWith("Swap:")) || null,
			freeText: memInfo,
		},
		disk: disk,
		node: nodeVer || process.version,
		npm: npmVer,
		ollama: {
			version: ollamaVersion,
			list: ollamaList,
		},
		gpu: gpu,
		hostname: os.hostname(),
	};
	return cached;
};
