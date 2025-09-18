import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import CsvDashboard from "./components/CsvDashboard";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CsvDashboard />
  </StrictMode>
);
