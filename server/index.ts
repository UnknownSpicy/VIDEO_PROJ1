import "dotenv/config";
import { createApp } from "./app";
const port = Number(process.env.PORT || 3001);
createApp().listen(port, "0.0.0.0", () =>
  console.log(
    `SIM PROJ1 server listening on ${port}. OpenRouter ${process.env.OPENROUTER_API_KEY ? "configured" : "optional; local mode available"}.`,
  ),
);
