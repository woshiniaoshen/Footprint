import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import WiresharkCompanion from "./WiresharkCompanion.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <WiresharkCompanion />
  </StrictMode>,
);
