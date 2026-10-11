import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { runMcpTools } from './tools.js';
import { VERSION } from '../version.js';

/**
 * MCP Server for Migration Guardian.
 *
 * Exposes the core engine as MCP tools that AI coding agents
 * (Claude Code, Cursor, etc.) can call to verify migrations inline.
 *
 * Start with: npx mgcheck mcp
 * Or: node dist/mcp/server.js
 */
async function main() {
  const server = new McpServer({
    name: 'mgcheck',
    version: VERSION,
  });

  // Register tools
  runMcpTools(server);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
