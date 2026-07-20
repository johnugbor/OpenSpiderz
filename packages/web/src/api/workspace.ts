export function currentWorkspaceId(): string {
  const workspaceId = sessionStorage.getItem("spiderz.workspace-id") ?? import.meta.env.VITE_WORKSPACE_ID;
  if (workspaceId === undefined || workspaceId.trim() === "") throw new Error("Select a workspace before continuing.");
  return workspaceId;
}
