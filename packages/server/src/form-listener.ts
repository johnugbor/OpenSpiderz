import type { FastifyInstance } from "fastify";
import type { JsonObject, JsonValue, NodeId, WorkflowId } from "@spiderz/shared";
import { QueueManager } from "./queue-manager.js";
import { WorkflowRepository } from "./workflow-repository.js";

interface FormParams { readonly workflowId: WorkflowId; readonly nodeId: NodeId; }
interface FormField { readonly name: string; readonly label: string; readonly type: "text" | "email" | "textarea"; readonly required: boolean; }
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;

/** Hosts public workflow-owned forms. Unlike third-party webhooks, no signing secret reaches the form user. */
export function registerFormListener(app: FastifyInstance, repository: WorkflowRepository, queue: QueueManager): void {
  app.get<{ Params: FormParams }>("/form/:workflowId/:nodeId", async (request, reply) => {
    const form = await resolveForm(request.params, repository);
    if (form === undefined) return reply.code(404).type("text/plain").send("Form not found or disabled.");
    return reply.type("text/html; charset=utf-8").send(renderForm(form.fields));
  });
  app.post<{ Params: FormParams; Body: unknown }>("/form/:workflowId/:nodeId", async (request, reply) => {
    const form = await resolveForm(request.params, repository);
    if (form === undefined) return reply.code(404).send({ error: "Form not found or disabled." });
    const body = sanitizeSubmission(request.body, form.fields);
    const job = await queue.enqueueExecution(request.params.workflowId, [{ body, receivedAt: new Date().toISOString(), source: "form" }]);
    return reply.code(202).send({ executionId: job.executionId, status: "queued" });
  });
}

async function resolveForm(params: FormParams, repository: WorkflowRepository): Promise<{ readonly fields: readonly FormField[] } | undefined> {
  if (!identifier.test(params.workflowId) || !identifier.test(params.nodeId)) return undefined;
  const workflow = await repository.getEnabledById(params.workflowId);
  const node = workflow?.nodes.find((candidate) => candidate.id === params.nodeId && candidate.type === "trigger" && candidate.parameters.triggerKind === "form");
  return node === undefined ? undefined : { fields: readFields(node.parameters.fields) };
}

function readFields(value: JsonValue | undefined): readonly FormField[] {
  if (!Array.isArray(value)) return defaultFields;
  const fields = value.flatMap((entry): FormField[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const name = entry.name, label = entry.label, type = entry.type, required = entry.required;
    if (typeof name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) || typeof label !== "string") return [];
    return [{ name, label: label.slice(0, 120), type: type === "email" || type === "textarea" ? type : "text", required: required === true }];
  });
  return fields.length === 0 ? defaultFields : fields.slice(0, 30);
}

function sanitizeSubmission(value: unknown, fields: readonly FormField[]): JsonObject {
  const source = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const output: Record<string, JsonValue> = {};
  for (const field of fields) {
    const raw = source[field.name];
    const text = typeof raw === "string" ? raw.trim().slice(0, 10_000) : "";
    if (field.required && text === "") throw Object.assign(new Error(`${field.label} is required.`), { statusCode: 400 });
    output[field.name] = text;
  }
  return output;
}

function renderForm(fields: readonly FormField[]): string {
  const controls = fields.map((field) => `<label>${escapeHtml(field.label)}${field.type === "textarea" ? `<textarea name="${field.name}" ${field.required ? "required" : ""}></textarea>` : `<input type="${field.type}" name="${field.name}" ${field.required ? "required" : ""}>`}</label>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Submit form</title><style>body{font:16px system-ui;margin:0;background:#f4f7fb;display:grid;place-items:center;min-height:100vh}main{background:#fff;padding:2rem;border-radius:12px;width:min(92vw,480px);box-shadow:0 8px 28px #0002}form{display:grid;gap:1rem}label{display:grid;gap:.4rem;font-weight:600}input,textarea,button{font:inherit;padding:.7rem;border:1px solid #cbd5e1;border-radius:7px}textarea{min-height:8rem}button{background:#2563eb;color:#fff;border:0;cursor:pointer}#status{min-height:1.5em}</style></head><body><main><h1>Contact us</h1><form id="form">${controls}<button>Submit</button></form><p id="status" role="status"></p></main><script>const f=document.querySelector('#form'),s=document.querySelector('#status');f.addEventListener('submit',async e=>{e.preventDefault();s.textContent='Submitting…';const body=Object.fromEntries(new FormData(f));const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const p=await r.json().catch(()=>({}));if(!r.ok){s.textContent=p.error||'Could not submit the form.';return}f.reset();s.textContent='Thank you. Your submission was received.'})</script></body></html>`;
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
const defaultFields: readonly FormField[] = [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "message", label: "Message", type: "textarea", required: true }];
