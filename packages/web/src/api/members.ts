import { authorizedHeaders } from "./auth.js";
import { currentWorkspaceId } from "./workspace.js";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
export type MemberRole = "owner" | "admin" | "member" | "read_only";
export interface WorkspaceMember { readonly id: string; readonly email: string; readonly role: MemberRole; }

export async function members(): Promise<WorkspaceMember[]> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/members`, { headers: authorizedHeaders() });
  if (!response.ok) throw new Error("Could not load workspace members.");
  return response.json() as Promise<WorkspaceMember[]>;
}
export async function inviteMember(email: string, role: Exclude<MemberRole, "owner">): Promise<{ invitationToken: string; expiresInDays: number }> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/invitations`, { method: "POST", headers: authorizedHeaders(), body: JSON.stringify({ email, role }) });
  if (!response.ok) throw new Error("Could not create invitation.");
  return response.json() as Promise<{ invitationToken: string; expiresInDays: number }>;
}
export async function acceptInvitation(token: string): Promise<void> {
  const response = await fetch(`${API}/api/invitations/accept`, { method: "POST", headers: authorizedHeaders(), body: JSON.stringify({ token }) });
  if (!response.ok) throw new Error("Could not accept invitation.");
}
export async function updateMemberRole(userId: string, role: Exclude<MemberRole, "owner">): Promise<void> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/members/${userId}`, { method: "PATCH", headers: authorizedHeaders(), body: JSON.stringify({ role }) });
  if (!response.ok) throw new Error("Could not update member role.");
}
export async function removeMember(userId: string): Promise<void> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/members/${userId}`, { method: "DELETE", headers: authorizedHeaders() });
  if (!response.ok) throw new Error("Could not remove member.");
}
export interface PendingInvitation { readonly id: string; readonly email: string; readonly role: Exclude<MemberRole, "owner">; readonly expires_at: string; }
export async function invitations(): Promise<PendingInvitation[]> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/invitations`, { headers: authorizedHeaders() });
  if (!response.ok) throw new Error("Could not load invitations.");
  return response.json() as Promise<PendingInvitation[]>;
}
export async function revokeInvitation(id: string): Promise<void> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/invitations/${id}`, { method: "DELETE", headers: authorizedHeaders() });
  if (!response.ok) throw new Error("Could not revoke invitation.");
}
