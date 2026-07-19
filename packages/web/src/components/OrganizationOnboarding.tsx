import { useState, type ReactElement } from "react";
import { authorizedHeaders } from "../api/auth.js";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export function OrganizationOnboarding({ onDone }: { readonly onDone: () => void }): ReactElement {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const createOrganization = (): void => {
    setSubmitting(true); setError(undefined);
    void fetch(`${API}/api/organizations`, { method: "POST", headers: authorizedHeaders(), body: JSON.stringify({ name, slug }) })
      .then(async (response): Promise<{ developmentWorkspaceId: string }> => { const payload: unknown = await response.json(); if (!response.ok) throw new Error(typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Could not create organization."); if (typeof payload !== "object" || payload === null || !('developmentWorkspaceId' in payload) || typeof payload.developmentWorkspaceId !== "string") throw new Error("The server returned an invalid workspace response."); return { developmentWorkspaceId: payload.developmentWorkspaceId }; })
      .then((payload) => { sessionStorage.setItem("spiderz.workspace-id", payload.developmentWorkspaceId); onDone(); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not create organization."))
      .finally(() => setSubmitting(false));
  };
  return <main className="auth"><form onSubmit={(event) => { event.preventDefault(); createOrganization(); }}><h1>Create organization</h1><input required placeholder="Organization name" value={name} onChange={(event) => setName(event.target.value)} /><input required pattern="[a-z0-9][a-z0-9-]{1,62}" placeholder="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} />{error !== undefined && <p role="alert">{error}</p>}<button disabled={submitting}>{submitting ? "Creating..." : "Create development workspace"}</button></form></main>;
}
