import { config } from "./config.js";
import { DB_PATH } from "./db/index.js";
import { createApp, hasClientBuild } from "./app.js";

const app = createApp();

app.listen(config.port, () => {
  const built = hasClientBuild();
  console.log("");
  console.log("  HireTrack API  ->  http://localhost:" + config.port);
  console.log("  Database file  ->  " + DB_PATH);
  console.log(
    "  Google sign-in ->  " +
      (config.google.enabled ? "enabled" : "disabled (email + password only)")
  );
  console.log(
    "  React app      ->  " +
      (built
        ? "http://localhost:" + config.port + "  (built files)"
        : "http://localhost:5173  (run `npm run dev`)")
  );
  console.log("");
});
