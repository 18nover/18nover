import { Authenticator } from "./auth.js";
import { CameraService } from "./cameras.js";
import { loadConfig } from "./config.js";
import { RelayDatabase } from "./db.js";
import { MediaMtxClient } from "./mediamtx.js";
import { CameraProber } from "./probe.js";
import { createRelayServer } from "./server.js";
import { TranscoderSupervisor } from "./supervisor.js";

async function main() {
  const config = loadConfig();
  const db = new RelayDatabase(config.dbPath);
  const auth = new Authenticator(config, db);
  await auth.initialize();
  const media = new MediaMtxClient(config, auth);
  const prober = new CameraProber(config, media, auth);
  let cameras: CameraService;
  const supervisor = new TranscoderSupervisor(config, auth, (id, state) => cameras?.updateState(id.split(":", 1)[0]!, state));
  cameras = new CameraService(config, db, media, prober, supervisor, auth);
  const server = createRelayServer(config, auth, cameras, media);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "0.0.0.0", () => resolve());
  });
  console.info(JSON.stringify({ level: "info", event: "controller_ready", port: config.port }));
  void cameras.reconcile();
  const statusTimer = setInterval(() => void cameras.refreshStatuses(), 10_000);
  statusTimer.unref();

  const shutdown = async () => {
    server.close();
    clearInterval(statusTimer);
    await supervisor.shutdown();
    db.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch(() => {
  console.error(JSON.stringify({ level: "error", event: "controller_start_failed" }));
  process.exit(1);
});
