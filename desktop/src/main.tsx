import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { DISTRIBUTION_CHANNEL } from "./tauri/updater";

document.documentElement.dataset.channel = DISTRIBUTION_CHANNEL;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
