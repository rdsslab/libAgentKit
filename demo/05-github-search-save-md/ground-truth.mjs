import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "../_lib/common.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const headers = { "User-Agent": "agentkit-demo", "Accept": "application/vnd.github+json" };

const fetchJson = async (url) => {
	const startedAt = Date.now();
	try {
		const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
		const text = await res.text();
		let json = null;
		try { json = JSON.parse(text); } catch {}
		return { ok: res.ok, status: res.status, durationMs: Date.now() - startedAt, url, json, text: json ? undefined : text.slice(0, 1000) };
	} catch (error) {
		return { ok: false, durationMs: Date.now() - startedAt, url, error: error?.message || String(error) };
	}
};

const user = await fetchJson("https://api.github.com/users/edwinspire");
const search = await fetchJson("https://api.github.com/search/users?q=edwinspire");

const summary = user.ok && user.json ? {
	login: user.json.login,
	id: user.json.id,
	name: user.json.name,
	html_url: user.json.html_url,
	bio: user.json.bio,
	location: user.json.location,
	blog: user.json.blog,
	company: user.json.company,
	public_repos: user.json.public_repos,
	public_gists: user.json.public_gists,
	followers: user.json.followers,
	following: user.json.following,
	created_at: user.json.created_at,
	updated_at: user.json.updated_at,
} : null;

const out = {
	test: "05-github-search-save-md-ground-truth",
	timestamp: new Date().toISOString(),
	expected: {
		login: "edwinspire",
		profileUrl: "https://github.com/edwinspire",
	},
	summary,
	api: { user, search },
};

const file = path.join(dir, "results", "ground-truth.json");
await writeJson(file, out);
console.log(JSON.stringify({ ...out, api: { user: { ...user, json: user.json ? "{...}" : null }, search: { ...search, json: search.json ? "{...}" : null } } }, null, 2));
console.log("Summary:", JSON.stringify(summary, null, 2));
console.log(`\nSaved: ${file}`);
