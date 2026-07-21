import { useEffect, useState, type ReactElement } from "react";
import type { IWorkflow } from "@spiderz/shared";
import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  listWorkflows,
  openWorkflow,
  setWorkflowEnabled,
  type WorkflowFilter,
  workspaceId,
  workspaces,
} from "../api/dashboard.js";
import { acceptInvitation, invitations, inviteMember, members, removeMember, revokeInvitation, updateMemberRole, type MemberRole, type PendingInvitation, type WorkspaceMember } from "../api/members.js";
import { googleAuthorizationUrl } from "../api/google-oauth.js";
import { slackAuthorizationUrl } from "../api/slack-oauth.js";
import { notionAuthorizationUrl } from "../api/notion-oauth.js";
import { airtableAuthorizationUrl } from "../api/airtable-oauth.js";
import { outlookAuthorizationUrl } from "../api/outlook-oauth.js";
import { credentials } from "../api/credentials.js";

type Summary = { id: string; name: string; enabled: boolean; updated_at: string; last_execution_status: string | null };
type Workspace = { id: string; name: string; environment: string; role: string; organization_name: string };

export function Dashboard({ onOpen, onSignOut }: { readonly onOpen: (workflow: IWorkflow) => void; readonly onSignOut: () => void }): ReactElement {
  const [items, setItems] = useState<Summary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [workspace, setWorkspace] = useState(workspaceId());
  const [available, setAvailable] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingDeletion, setPendingDeletion] = useState<Summary>();
  const [showMembers, setShowMembers] = useState(false);
  const [memberList, setMemberList] = useState<WorkspaceMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [pendingMemberRemoval, setPendingMemberRemoval] = useState<WorkspaceMember>();
  const [pendingInvitationRevocation, setPendingInvitationRevocation] = useState<PendingInvitation>();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<MemberRole, "owner">>("member");
  const [inviteLink, setInviteLink] = useState<string>();
  const [showAcceptInvite, setShowAcceptInvite] = useState(false);
  const [invitationToken, setInvitationToken] = useState("");
  const [connectedProviders, setConnectedProviders] = useState<ReadonlySet<string>>(new Set());

  const current = available.find((item) => item.id === workspace);
  const canEdit = current?.role !== "read_only";
  const canManage = current?.role === "owner" || current?.role === "admin";

  const load = (): void => {
    setLoading(true);
    void listWorkflows(query, page, filter)
      .then((response) => { setItems(response.items); setTotal(response.total); })
      .then(() => setError(undefined))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load workflows."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void workspaces()
      .then(setAvailable)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load workspaces."));
  }, []);
  useEffect(load, [query, workspace, page, filter]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(queryDraft); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);
  useEffect(() => {
    if (notice === undefined) return;
    const timer = window.setTimeout(() => setNotice(undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (workspace.trim() === "") { setConnectedProviders(new Set()); return; }
    void credentials()
      .then((items) => setConnectedProviders(new Set(items.filter((item) => item.type === "oauth2").map((item) => item.name.replace(/ OAuth2$/i, "").toLowerCase()))))
      .catch(() => setConnectedProviders(new Set()));
  }, [workspace]);

  const choose = (id: string): void => {
    setWorkspace(id);
    setPage(1);
    sessionStorage.setItem("spiderz.workspace-id", id);
  };
  const action = (job: Promise<unknown>, message: string): void => {
    void job.then(() => { setNotice(message); load(); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Request failed."));
  };
  const refreshMembers = (): void => { void members().then(setMemberList).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load members.")); void invitations().then(setPendingInvitations).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load invitations.")); };
  const openMembers = (): void => { setShowMembers(true); setInviteLink(undefined); refreshMembers(); };
  const invite = (): void => { void inviteMember(inviteEmail, inviteRole).then((response) => { setInviteLink(response.invitationToken); setInviteEmail(""); return members(); }).then(setMemberList).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not create invitation.")); };
  const changeMemberRole = (userId: string, role: Exclude<MemberRole, "owner">): void => { void updateMemberRole(userId, role).then(refreshMembers).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not update member role.")); };
  const removeWorkspaceMember = (userId: string): void => { void removeMember(userId).then(refreshMembers).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove member.")); };
  const revokePendingInvitation = (id: string): void => { void revokeInvitation(id).then(refreshMembers).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not revoke invitation.")); };
  const acceptInvite = (): void => { void acceptInvitation(invitationToken).then(() => workspaces()).then((updatedWorkspaces) => { setAvailable(updatedWorkspaces); setShowAcceptInvite(false); setInvitationToken(""); setNotice("Invitation accepted. Choose the new workspace from the selector."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not accept invitation.")); };
  const connectGoogle = (): void => { void googleAuthorizationUrl().then((url) => { window.open(url, "spiderz-google-oauth", "popup,width=560,height=700"); setNotice("Complete Google authorization in the window that opened, then refresh this page."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not start Google authorization.")); };
  const connectSlack = (): void => { void slackAuthorizationUrl().then((url) => { window.open(url, "spiderz-slack-oauth", "popup,width=560,height=700"); setNotice("Complete Slack installation in the window that opened, then refresh this page."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not start Slack authorization.")); };
  const connectNotion = (): void => { void notionAuthorizationUrl().then((url) => { window.open(url, "spiderz-notion-oauth", "popup,width=560,height=700"); setNotice("Choose the Notion pages to share in the window that opened, then refresh this page."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not start Notion authorization.")); };
  const connectAirtable = (): void => { void airtableAuthorizationUrl().then((url) => { window.open(url, "spiderz-airtable-oauth", "popup,width=560,height=700"); setNotice("Choose the Airtable bases to share in the window that opened, then refresh this page."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not start Airtable authorization.")); };
  const connectOutlook = (): void => { void outlookAuthorizationUrl().then((url) => { window.open(url, "spiderz-outlook-oauth", "popup,width=560,height=700"); setNotice("Complete Microsoft authorization in the window that opened, then refresh this page."); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not start Microsoft authorization.")); };
  const connected = (provider: string): boolean => connectedProviders.has(provider);

  return <main className="dashboard">
    <header className="dashboard-header">
      <div><h1>Workflows</h1>{current !== undefined && <small>{current.role.replace("_", " ")} access</small>}</div>
      <div className="dashboard-actions">
        <select aria-label="Workspace" value={workspace} onChange={(event) => choose(event.target.value)}>
          {available.map((item) => <option key={item.id} value={item.id}>{item.organization_name} / {item.name}</option>)}
        </select>
        <button className="join-workspace-button" onClick={() => setShowAcceptInvite(true)}>Join workspace</button>
        {canManage && <button className="members-button" onClick={openMembers}>Members</button>}
        {canEdit && <button className={connected("google") ? "integration-connected" : undefined} onClick={connectGoogle}>{connected("google") ? "✓ Google" : "Connect Google"}</button>}
        {canEdit && <button className={connected("slack") ? "integration-connected" : undefined} onClick={connectSlack}>{connected("slack") ? "✓ Slack" : "Connect Slack"}</button>}
        {canEdit && <button className={connected("notion") ? "integration-connected" : undefined} onClick={connectNotion}>{connected("notion") ? "✓ Notion" : "Connect Notion"}</button>}
        {canEdit && <button className={connected("airtable") ? "integration-connected" : undefined} onClick={connectAirtable}>{connected("airtable") ? "✓ Airtable" : "Connect Airtable"}</button>}
        {canEdit && <button className={connected("outlook") ? "integration-connected" : undefined} onClick={connectOutlook}>{connected("outlook") ? "✓ Outlook" : "Connect Outlook"}</button>}
        {canEdit && <button className="new-workflow-button" onClick={() => void createWorkflow().then(onOpen)}>＋ New workflow</button>}
        <button className="secondary refresh-button" disabled={loading} onClick={load}>{loading ? "Refreshing…" : "↻ Refresh"}</button>
        <button className="secondary signout-button" onClick={onSignOut}>Sign out ↗</button>
      </div>
    </header>
    <div className="workflow-filters"><input className="workflow-search" placeholder="Search workflows" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} /><select aria-label="Workflow filter" value={filter} onChange={(event) => { setFilter(event.target.value as WorkflowFilter); setPage(1); }}><option value="all">All workflows</option><option value="active">Active</option><option value="draft">Draft</option><option value="failed">Has failed runs</option><option value="owned">Owned by me</option></select></div>
    {notice !== undefined && <p className="notice" role="status">{notice}</p>}
    {error !== undefined && <p className="error" role="alert"><span>{error}</span><button type="button" onClick={load}>Try again</button><button type="button" className="message-close" aria-label="Dismiss error" onClick={() => setError(undefined)}>×</button></p>}
    {loading ? <p>Loading workflows...</p> : items.length === 0 ? <section className="workflow-empty"><h2>No workflows yet</h2><p>Create your first workflow to begin automating.</p>{canEdit && <button onClick={() => void createWorkflow().then(onOpen)}>Create workflow</button>}</section> : <><ul className="workflow-list">
      {items.map((item) => <li key={item.id}>
        <div><button className="workflow-open" onClick={() => void openWorkflow(item.id).then(onOpen)}>{item.name}</button><small>{item.enabled ? "Active" : "Disabled"} · Updated {new Date(item.updated_at).toLocaleString()}</small></div>
        <div className="workflow-row-actions"><span className={`execution-status execution-${item.last_execution_status ?? "none"}`}>{item.last_execution_status ?? "Not run"}</span>
          {canEdit && <button onClick={() => void duplicateWorkflow(item.id).then(onOpen)}>Duplicate</button>}
          {canManage && <button onClick={() => action(setWorkflowEnabled(item.id, !item.enabled), item.enabled ? "Workflow disabled." : "Workflow enabled.")}>{item.enabled ? "Disable" : "Enable"}</button>}
          {canManage && <button className="danger" onClick={() => setPendingDeletion(item)}>Delete</button>}
        </div>
      </li>)}
    </ul><nav className="pagination" aria-label="Workflow pages"><button disabled={page === 1} onClick={() => setPage((currentPage) => currentPage - 1)}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total / 20))} · {total} workflows</span><button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage((currentPage) => currentPage + 1)}>Next</button></nav></>}
    {pendingDeletion !== undefined && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <h2 id="delete-title">Delete workflow?</h2><p><strong>{pendingDeletion.name}</strong> and its development history will be permanently removed.</p>
      <div><button onClick={() => setPendingDeletion(undefined)}>Cancel</button><button className="danger" onClick={() => { action(deleteWorkflow(pendingDeletion.id), "Workflow deleted."); setPendingDeletion(undefined); }}>Delete workflow</button></div>
    </section></div>}
    {showMembers && <div className="dialog-backdrop" role="presentation"><section className="dialog members-dialog" role="dialog" aria-modal="true" aria-labelledby="members-title"><button className="dialog-close" aria-label="Close" onClick={() => setShowMembers(false)}>×</button><h2 id="members-title">Workspace members</h2><ul>{memberList.map((member) => <li key={member.id}><span>{member.email}</span>{member.role === "owner" ? <small>owner</small> : <span className="member-actions"><select aria-label={`Role for ${member.email}`} value={member.role} onChange={(event) => changeMemberRole(member.id, event.target.value as Exclude<MemberRole, "owner">)}><option value="admin">Admin</option><option value="member">Member</option><option value="read_only">Read only</option></select><button className="danger" onClick={() => setPendingMemberRemoval(member)}>Remove</button></span>}</li>)}</ul><h3>Pending invitations</h3>{pendingInvitations.length === 0 ? <small>No pending invitations.</small> : <ul>{pendingInvitations.map((invitation) => <li key={invitation.id}><span>{invitation.email}<small>{invitation.role} · expires {new Date(invitation.expires_at).toLocaleDateString()}</small></span><button className="danger" onClick={() => setPendingInvitationRevocation(invitation)}>Revoke</button></li>)}</ul>}<h3>Invite member</h3><input aria-label="Invite email" type="email" placeholder="name@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<MemberRole, "owner">)}><option value="admin">Admin</option><option value="member">Member</option><option value="read_only">Read only</option></select><button disabled={inviteEmail.trim() === ""} onClick={invite}>Create invitation</button>{inviteLink !== undefined && <p className="notice">Invitation token: <code>{inviteLink}</code><button onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => setNotice("Invitation token copied."))}>Copy token</button></p>}</section></div>}
    {pendingMemberRemoval !== undefined && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="remove-member-title"><h2 id="remove-member-title">Remove member?</h2><p><strong>{pendingMemberRemoval.email}</strong> will immediately lose workspace access.</p><div><button onClick={() => setPendingMemberRemoval(undefined)}>Cancel</button><button className="danger" onClick={() => { removeWorkspaceMember(pendingMemberRemoval.id); setPendingMemberRemoval(undefined); }}>Remove member</button></div></section></div>}
    {pendingInvitationRevocation !== undefined && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-invitation-title"><h2 id="revoke-invitation-title">Revoke invitation?</h2><p><strong>{pendingInvitationRevocation.email}</strong> will no longer be able to join with this invitation.</p><div><button onClick={() => setPendingInvitationRevocation(undefined)}>Cancel</button><button className="danger" onClick={() => { revokePendingInvitation(pendingInvitationRevocation.id); setPendingInvitationRevocation(undefined); }}>Revoke invitation</button></div></section></div>}
    {showAcceptInvite && <div className="dialog-backdrop" role="presentation"><section className="dialog members-dialog" role="dialog" aria-modal="true" aria-labelledby="accept-invite-title"><button className="dialog-close" aria-label="Close" onClick={() => setShowAcceptInvite(false)}>×</button><h2 id="accept-invite-title">Join workspace</h2><p>Paste the invitation token shared by the workspace owner.</p><input aria-label="Invitation token" value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} /><button disabled={invitationToken.trim() === ""} onClick={acceptInvite}>Accept invitation</button></section></div>}
  </main>;
}
