import { Daemon, getDefaultConfig } from "./daemon/daemon.js";
import { DEFAULT_WEB_PORT } from "./web/server.js";
import { errorMessage, logEvent, setDaemonDebugEnabled } from "./shared/daemon-log.js";

/**
 * Daemon entry point for background process.
 */
async function main() {
  setDaemonDebugEnabled(process.argv.includes("--debug"));
  const config = getDefaultConfig();

  // Read web config from environment variables (set by CLI)
  const webPortEnv = process.env.HIBOSS_WEB_PORT;
  const webEnabledEnv = process.env.HIBOSS_WEB_ENABLED;
  config.web = {
    port: webPortEnv ? parseInt(webPortEnv, 10) : DEFAULT_WEB_PORT,
    enabled: webEnabledEnv !== "false",
  };

  const daemon = new Daemon(config);

  // Graceful shutdown
  const shutdown = async () => {
    logEvent("info", "daemon-shutdown-requested");
    await daemon.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await daemon.start();
  } catch (err) {
    logEvent("error", "daemon-start-failed", { error: errorMessage(err) });
    process.exit(1);
  }
}

main();
