import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkflowCanvas } from "./components/WorkflowCanvas.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><WorkflowCanvas initialWorkflow={{ id: "new-workflow", name: "Untitled workflow", nodes: [], connections: [], settings: {}, variables: {} }} /></StrictMode>);
