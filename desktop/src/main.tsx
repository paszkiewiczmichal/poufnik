import React from "react";
import ReactDOM from "react-dom/client";

import { isProgressWindow } from "./tauri/shellActions";
import { DISTRIBUTION_CHANNEL } from "./tauri/updater";

document.documentElement.dataset.channel = DISTRIBUTION_CHANNEL;

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// The small corner window of Explorer menu actions loads only its own component.
if (isProgressWindow()) {
  void import("./components/ShellProgressPopup").then(({ ShellProgressPopup }) => {
    document.documentElement.classList.add("progress-window");
    root.render(
      <React.StrictMode>
        <ShellProgressPopup />
      </React.StrictMode>,
    );
  });
} else {
  void import("./App").then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
