import { WebSocketServer } from "ws";

export function createWebSocketServer(httpServer) {
	const wss = new WebSocketServer({ server: httpServer });

	const clients = new Set();

	wss.on("connection", (ws) => {
		clients.add(ws);
		console.log("🔌 WebSocket client connected. Total: " + clients.size);

		ws.send(JSON.stringify({
			type: "init",
			data: { connected: true, timestamp: Date.now() }
		}));

		ws.on("message", (message) => {
			try {
				const data = JSON.parse(message);
			} catch (e) {
				// Ignore non-JSON messages
			}
		});

		ws.on("close", () => {
			clients.delete(ws);
			console.log("🔌 WebSocket client disconnected. Total: " + clients.size);
		});
	});

	const broadcast = (message) => {
		const messageStr = JSON.stringify(message);
		clients.forEach((client) => {
			if (client.readyState === 1) { // WebSocket.OPEN
				client.send(messageStr);
			}
		});
	};

	return { wss, broadcast };
}
