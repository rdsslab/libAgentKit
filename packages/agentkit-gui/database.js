import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Capa de persistencia SQLite para AgentKit GUI.
 * Todo el historial de conversaciones vive en un solo archivo .sqlite
 * dentro del directorio .agentkit del workspace.
 *
 * TODO: en el futuro, encriptar el archivo .sqlite para proteger la
 * información sensible de las conversaciones.
 */

export class AgentKitDatabase {
	constructor({ dbPath }) {
		this.dbPath = dbPath;
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath);
		this.db.pragma('journal_mode = WAL');
		this.db.pragma('foreign_keys = ON');
		this._initSchema();
	}

	_initSchema() {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				workspace TEXT NOT NULL DEFAULT 'default',
				title TEXT NOT NULL DEFAULT 'Sesión sin título',
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				model TEXT,
				provider TEXT DEFAULT 'ollama',
				base_url TEXT DEFAULT 'http://127.0.0.1:11434'
			);

			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL,
				role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
				content TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				token_count INTEGER DEFAULT 0,
				order_index INTEGER NOT NULL DEFAULT 0,
				FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, order_index);
			CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
			CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace, updated_at);
		`);
	}

	// ── Sesiones ──────────────────────────────────────────────

	createSession(opts = {}) {
		const now = Date.now();
		const sessionId = opts.id || `sess_${now}_${Math.random().toString(36).slice(2, 8)}`;
		const workspace = opts.workspace || 'default';
		const title = opts.title || 'Sesión sin título';
		const model = opts.model || null;
		const provider = opts.provider || 'ollama';
		const baseUrl = opts.baseUrl || 'http://127.0.0.1:11434';
		this.db.prepare(`
			INSERT INTO sessions (id, workspace, title, created_at, updated_at, model, provider, base_url)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).run(sessionId, workspace, title, now, now, model, provider, baseUrl);
		return {
			id: sessionId,
			workspace,
			title,
			created_at: now,
			updated_at: now,
			model,
			provider,
			base_url: baseUrl,
		};
	}

	getSession(sessionId) {
		return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
	}

	getSessions({ workspace = 'default', limit = 50, beforeDate = null } = {}) {
		let sql = 'SELECT * FROM sessions WHERE workspace = ?';
		const params = [workspace];
		if (beforeDate) {
			sql += ' AND updated_at < ?';
			params.push(beforeDate);
		}
		sql += ' ORDER BY updated_at DESC LIMIT ?';
		params.push(limit);
		return this.db.prepare(sql).all(params);
	}

	updateSession(sessionId, opts = {}) {
		const sets = [];
		const params = [];
		if (opts.title !== undefined) { sets.push('title = ?'); params.push(opts.title); }
		if (opts.model !== undefined) { sets.push('model = ?'); params.push(opts.model); }
		if (opts.provider !== undefined) { sets.push('provider = ?'); params.push(opts.provider); }
		if (opts.baseUrl !== undefined) { sets.push('base_url = ?'); params.push(opts.baseUrl); }
		if (sets.length === 0) return this.getSession(sessionId);
		sets.push('updated_at = ?');
		params.push(Date.now(), sessionId);
		this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
		return this.getSession(sessionId);
	}

	deleteSession(sessionId) {
		const session = this.getSession(sessionId);
		this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
		return session;
	}

	// ── Mensajes ──────────────────────────────────────────────

	addMessage(opts = {}) {
		const now = Date.now();
		const sessionId = opts.sessionId;
		const role = opts.role;
		const content = opts.content;
		const tokenCount = opts.tokenCount || 0;
		let orderIndex = opts.orderIndex;
		if (orderIndex === null || orderIndex === undefined) {
			const last = this.db.prepare('SELECT MAX(order_index) as m FROM messages WHERE session_id = ?').get(sessionId);
			orderIndex = (last.m != null ? last.m : -1) + 1;
		}
		const result = this.db.prepare(`
			INSERT INTO messages (session_id, role, content, created_at, token_count, order_index)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(sessionId, role, content, now, tokenCount, orderIndex);
		// Actualizar updated_at de la sesión
		this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
		return { id: result.lastInsertRowid, sessionId, role, content, created_at: now, tokenCount, orderIndex };
	}

	getMessages(opts = {}) {
		const sessionId = opts.sessionId;
		const limit = opts.limit;
		const beforeOrder = opts.beforeOrder;
		const afterOrder = opts.afterOrder;
		let sql = 'SELECT * FROM messages WHERE session_id = ?';
		const params = [sessionId];
		if (beforeOrder !== null && beforeOrder !== undefined) {
			sql += ' AND order_index < ?';
			params.push(beforeOrder);
		}
		if (afterOrder !== null && afterOrder !== undefined) {
			sql += ' AND order_index > ?';
			params.push(afterOrder);
		}
		sql += ' ORDER BY order_index ASC';
		if (limit != null && limit !== undefined) {
			sql += ' LIMIT ?';
			params.push(limit);
		}
		return this.db.prepare(sql).all(params);
	}

	countMessages(sessionId) {
		const row = this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(sessionId);
		return row.c;
	}

	close() {
		this.db.close();
	}
}
