import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import NetWatch from "./NetWatch.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <NetWatch />
  </StrictMode>,
);
