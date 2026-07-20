import type { IBinaryData } from "@spiderz/shared";
import { authorizedHeaders } from "./auth.js";
import { currentWorkspaceId } from "./workspace.js";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
export async function uploadBinary(file: File): Promise<IBinaryData> { const data = new FormData(); data.append("file", file); const headers = new Headers(authorizedHeaders()); headers.delete("content-type"); const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/files`, { method: "POST", headers, body: data }); if (!response.ok) throw new Error("Could not upload file."); return response.json() as Promise<IBinaryData>; }
export async function downloadBinary(reference: IBinaryData): Promise<void> { const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/files/${reference.dataId}`, { headers: authorizedHeaders() }); if (!response.ok) throw new Error("Could not download file."); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = reference.fileName; link.click(); URL.revokeObjectURL(url); }
export async function binaryPreviewUrl(reference: IBinaryData): Promise<string> { const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/files/${reference.dataId}`, { headers: authorizedHeaders() }); if (!response.ok) throw new Error("Could not load file preview."); return URL.createObjectURL(await response.blob()); }
