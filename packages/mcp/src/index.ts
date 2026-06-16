#!/usr/bin/env node
// make-testkit MCP server — exposes the Make.com offline engine over the Model
// Context Protocol so any MCP client (Claude Code, Claude Desktop, ...) can
// evaluate IML, simulate blueprint runs, lint scenarios, and run test suites.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerEvalIml, registerSimulate, registerLint, registerRunTestsuite } from "./tools.js";

const server = new McpServer({ name: "make-testkit", version: "0.1.0" });

registerEvalIml(server);
registerSimulate(server);
registerLint(server);
registerRunTestsuite(server);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logs; stdout is the protocol channel.
process.stderr.write("make-testkit MCP server ready (stdio)\n");
