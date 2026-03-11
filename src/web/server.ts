/**
 * Hi-Boss Web Server.
 *
 * Embedded HTTP + WebSocket server for the management UI.
 * Runs inside the daemon process, shares DaemonContext.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, sendJson } from "./router.js";
import { setCorsHeaders } from "./middleware/auth.js";
import { createStaticHandler } from "./middleware/static.js";
import { createStatusHandlers } from "./handlers/status.js";
import { createAgentHandlers } from "./handlers/agents.js";
import { createEnvelopeHandlers } from "./handlers/envelopes.js";
import { createProjectSkillHandlers } from "./handlers/project-skills.js";
import { createProjectMemoryHandlers } from "./handlers/project-memory.js";
import { createProjectHandlers } from "./handlers/projects.js";
import { createPromptHandlers } from "./handlers/prompts.js";
import { createConfigHandlers } from "./handlers/config.js";
import { createEnvelopeBrowseHandlers } from "./handlers/envelope-browse.js";
import { createConversationHandlers } from "./handlers/conversations.js";
import { ChatWebSocket } from "./ws/chat.js";
import type { DaemonContext } from "../daemon/rpc/context.js";
import { logEvent } from "../shared/daemon-log.js";

export interface WebServerConfig {
  port: number;
  enabled: boolean;
}

export const DEFAULT_WEB_PORT = 7749;

export class WebServer {
  private server: http.Server | null = null;
  private router: Router;
  private serveStatic: ReturnType<typeof createStaticHandler>;
  private chatWs: ChatWebSocket;

  constructor(
    private config: WebServerConfig,
    private daemon: DaemonContext,
  ) {
    this.router = new Router();
    this.chatWs = new ChatWebSocket(daemon);
    this.registerRoutes();

    // Static files: look in dist/web/ relative to project root
    const staticDir = this.resolveStaticDir();
    this.serveStatic = createStaticHandler(staticDir);
  }

  private resolveStaticDir(): string {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    // When running from dist/src/web/, look for dist/web/
    const distWeb = path.resolve(thisDir, "../../web");
    // When running from source src/web/, look for web/dist/
    const devWeb = path.resolve(thisDir, "../../web/dist");

    for (const dir of [distWeb, devWeb]) {
      if (fs.existsSync(dir)) return dir;
    }
    return distWeb;
  }

  private registerRoutes(): void {
    const api = "/api/v1";

    // Status
    const statusHandlers = createStatusHandlers(this.daemon);
    this.router.get(`${api}/status`, statusHandlers.getStatus);
    this.router.get(`${api}/time`, statusHandlers.getTime);

    // Agents
    const agentHandlers = createAgentHandlers(this.daemon);
    this.router.get(`${api}/agents`, agentHandlers.listAgents);
    this.router.get(`${api}/agents/:name/status`, agentHandlers.getAgentStatus);
    this.router.put(`${api}/agents/:name`, agentHandlers.updateAgent);
    this.router.delete(`${api}/agents/:name`, agentHandlers.deleteAgent);
    this.router.post(`${api}/agents/:name/refresh`, agentHandlers.refreshAgent);
    this.router.post(`${api}/agents/:name/abort`, agentHandlers.abortAgent);
    this.router.get(`${api}/agents/:name/skills/remote`, agentHandlers.listRemoteSkills);
    this.router.post(`${api}/agents/:name/skills/remote`, agentHandlers.addRemoteSkill);
    this.router.post(`${api}/agents/:name/skills/remote/:skillName/update`, agentHandlers.updateRemoteSkill);
    this.router.delete(`${api}/agents/:name/skills/remote/:skillName`, agentHandlers.removeRemoteSkill);

    // Chat / Envelopes
    const envelopeHandlers = createEnvelopeHandlers(this.daemon);
    this.router.post(`${api}/chat/:agentName/send`, envelopeHandlers.sendMessage);
    this.router.get(`${api}/chat/:agentName/messages`, envelopeHandlers.listMessages);

    // Projects
    const projectHandlers = createProjectHandlers(this.daemon);
    const projectSkillHandlers = createProjectSkillHandlers(this.daemon);
    const projectMemoryHandlers = createProjectMemoryHandlers(this.daemon);
    this.router.get(`${api}/projects`, projectHandlers.listProjects);
    this.router.post(`${api}/projects`, projectHandlers.createProject);
    this.router.get(`${api}/projects/:id`, projectHandlers.getProject);
    this.router.put(`${api}/projects/:id`, projectHandlers.updateProject);
    this.router.post(`${api}/projects/:id/leaders`, projectHandlers.upsertLeader);
    this.router.put(`${api}/projects/:id/leaders/:agentName`, projectHandlers.updateLeader);
    this.router.post(`${api}/projects/:id/select-leader`, projectHandlers.selectLeader);
    this.router.post(`${api}/projects/:id/chat/send`, projectHandlers.sendProjectChatMessage);
    this.router.get(`${api}/projects/:id/chat/messages`, projectHandlers.listProjectChatMessages);
    this.router.post(`${api}/projects/:id/tasks`, projectHandlers.createProjectTask);
    this.router.get(`${api}/projects/:id/tasks`, projectHandlers.listProjectTasks);
    this.router.get(`${api}/projects/:id/tasks/:taskId`, projectHandlers.getProjectTask);
    this.router.post(`${api}/projects/:id/tasks/:taskId/state`, projectHandlers.updateProjectTaskState);
    this.router.post(`${api}/projects/:id/tasks/:taskId/cancel`, projectHandlers.cancelProjectTask);
    this.router.post(`${api}/projects/:id/tasks/:taskId/progress`, projectHandlers.appendTaskProgress);
    this.router.get(`${api}/projects/:id/skills/remote`, projectSkillHandlers.listRemoteSkills);
    this.router.post(`${api}/projects/:id/skills/remote`, projectSkillHandlers.addRemoteSkill);
    this.router.post(
      `${api}/projects/:id/skills/remote/:skillName/update`,
      projectSkillHandlers.updateRemoteSkill
    );
    this.router.delete(
      `${api}/projects/:id/skills/remote/:skillName`,
      projectSkillHandlers.removeRemoteSkill
    );
    this.router.get(`${api}/projects/:id/memory`, projectMemoryHandlers.listMemory);
    this.router.get(`${api}/projects/:id/memory/:entryName`, projectMemoryHandlers.getMemoryEntry);
    this.router.put(`${api}/projects/:id/memory/:entryName`, projectMemoryHandlers.upsertMemoryEntry);
    this.router.delete(`${api}/projects/:id/memory/:entryName`, projectMemoryHandlers.deleteMemoryEntry);

    // Health check (no auth required)
    this.router.get(`${api}/ping`, async (ctx) => {
      sendJson(ctx.res, 200, { ok: true });
    });

    // Prompts
    const promptHandlers = createPromptHandlers(this.daemon);
    this.router.get(`${api}/prompts`, promptHandlers.listPrompts);
    this.router.get(`${api}/prompts/file`, promptHandlers.getPrompt);
    this.router.put(`${api}/prompts/file`, promptHandlers.updatePrompt);

    // Config
    const configHandlers = createConfigHandlers(this.daemon);
    this.router.get(`${api}/config`, configHandlers.getConfig);
    this.router.put(`${api}/config`, configHandlers.updateConfig);

    // Envelope browsing
    const envelopeBrowseHandlers = createEnvelopeBrowseHandlers(this.daemon);
    this.router.get(`${api}/envelopes`, envelopeBrowseHandlers.listEnvelopes);
    this.router.get(`${api}/envelopes/:id`, envelopeBrowseHandlers.getEnvelope);

    // Conversations
    const conversationHandlers = createConversationHandlers(this.daemon);
    this.router.post(`${api}/conversations`, conversationHandlers.createConversation);
    this.router.get(`${api}/conversations`, conversationHandlers.listConversations);
    this.router.get(`${api}/conversations/:id`, conversationHandlers.getConversation);
    this.router.get(`${api}/conversations/:id/messages`, conversationHandlers.listMessages);
    this.router.post(`${api}/conversations/:id/send`, conversationHandlers.sendMessage);
    this.router.put(`${api}/conversations/:id`, conversationHandlers.updateConversation);
    this.router.delete(`${api}/conversations/:id`, conversationHandlers.deleteConversation);
    this.router.post(`${api}/conversations/:id/grant-access`, conversationHandlers.grantAccess);
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // CORS
        setCorsHeaders(res);
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // Try API routes first
        const handled = await this.router.handle(req, res);
        if (handled) return;

        // Try static files
        if (this.serveStatic(req, res)) return;

        // 404
        sendJson(res, 404, { error: "Not found" });
      });

      // Attach WebSocket server to HTTP server
      this.chatWs.attach(this.server);

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logEvent("error", "web-server-port-in-use", { port: this.config.port });
          reject(new Error(`Web server port ${this.config.port} is already in use`));
        } else {
          reject(err);
        }
      });

      this.server.listen(this.config.port, () => {
        logEvent("info", "web-server-started", { port: this.config.port, websocket: true });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Stop WebSocket first
    await this.chatWs.shutdown();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logEvent("info", "web-server-stopped");
          resolve();
        });
        // Force close after 5s
        setTimeout(() => resolve(), 5000);
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.config.port;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Expose WebSocket for external event broadcasting. */
  getChatWebSocket(): ChatWebSocket {
    return this.chatWs;
  }
}
