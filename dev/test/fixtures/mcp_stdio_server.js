/**
 * Fixture: a local MCP server over stdio.
 *
 * It is spawned by the test suite as a child process, exactly like a real
 * stdio MCP server (the transport talks to it over stdin/stdout).
 *
 *   node dev/test/fixtures/mcp_stdio_server.js
 *
 * Tools:
 *   - echo(text): returns "echo:<text>"
 *   - fail(): always throws, to check the error path
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
	name: "fixture-stdio",
	version: "1.0.0",
});

server.registerTool(
	"echo",
	{
		title: "Echo",
		description: "Devuelve el texto recibido, precedido de 'echo:'.",
		inputSchema: {
			text: z.string().describe("texto a devolver"),
		},
	},
	async ({ text }) => ({
		content: [{ type: "text", text: `echo:${text}` }],
	}),
);

server.registerTool(
	"fail",
	{
		title: "Fail",
		description: "Falla siempre.",
		inputSchema: {},
	},
	async () => {
		throw new Error("fallo simulado del servidor");
	},
);

await server.connect(new StdioServerTransport());
