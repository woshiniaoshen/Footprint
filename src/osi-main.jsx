import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OSIExplorer from "./OSIExplorer.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <OSIExplorer />
  </StrictMode>,
);
