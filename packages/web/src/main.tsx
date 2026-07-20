import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IWorkflow } from "@spiderz/shared";
import { WorkflowCanvas } from "./components/WorkflowCanvas.js";
import { AuthScreen } from "./components/AuthScreen.js";
import { accessToken, signOut } from "./api/auth.js";
import { workspaces } from "./api/dashboard.js";
import { Dashboard } from "./components/Dashboard.js";
import { OrganizationOnboarding } from "./components/OrganizationOnboarding.js";
import { LandingPage } from "./components/LandingPage.js";
import "./styles.css";

function App() {
  const [signedIn, setSignedIn] = useState(accessToken() !== undefined);
  const [checkingWorkspace, setCheckingWorkspace] = useState(signedIn);
  const [ready, setReady] = useState(false);
  const [workflow, setWorkflow] = useState<IWorkflow>();
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!signedIn) { setReady(false); setCheckingWorkspace(false); return; }
    setCheckingWorkspace(true);
    void workspaces().then((available) => {
      const saved = sessionStorage.getItem("spiderz.workspace-id");
      const selected = available.find((workspace) => workspace.id === saved) ?? available[0];
      if (selected !== undefined) sessionStorage.setItem("spiderz.workspace-id", selected.id);
      setReady(selected !== undefined);
    }).catch(() => setReady(false)).finally(() => setCheckingWorkspace(false));
  }, [signedIn]);

  const leave = (): void => { signOut(); setWorkflow(undefined); setReady(false); setSignedIn(false); };
  if (!signedIn) return showAuth ? <AuthScreen onAuthenticated={() => setSignedIn(true)}/> : <LandingPage onStart={() => setShowAuth(true)}/>;
  if (checkingWorkspace) return <main className="auth"><p>Loading workspace…</p></main>;
  if (!ready) return <OrganizationOnboarding onDone={() => setReady(true)}/>;
  return workflow === undefined ? <Dashboard onOpen={setWorkflow} onSignOut={leave}/> : <WorkflowCanvas initialWorkflow={workflow} onBack={() => setWorkflow(undefined)}/>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
