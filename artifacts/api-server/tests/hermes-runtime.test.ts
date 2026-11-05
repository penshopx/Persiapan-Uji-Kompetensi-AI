import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { HermesRuntime, HermesError, executionIdentity } from "../src/lib/hermes-runtime";
import { createPracticeRuntime } from "../src/lib/competency-runtime";
import { executePracticeTurn } from "../src/lib/competency-agents";
import { catalog, getPracticeContext } from "../src/lib/competency-catalog";
import { CreatePracticeTurnResponse, type PracticeTurnInput } from "@workspace/api-zod";

type Run = { run_id: string; session_id: string; status: string; output: string };
const runs = new Map<string, Run>();
const keys = new Map<string, string>();
const submissions: { path: string; key: string; body: Record<string, string> }[] = [];
let unsafeTools = false, unsafeSkills = false, incomplete = false, wrongSession = false, illegalPlan = false, badSource = false, hang = false, oversized = false;
let stops = 0;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  assert.equal(req.headers.authorization, "Bearer synthetic-contract-test");
  const path = req.url!;
  if (path === "/v1/capabilities") {
    res.end(JSON.stringify({ platform: "hermes-agent", auth: { type: "bearer", required: true },
      features: { run_submission: true, run_status: true, run_stop: true } })); return;
  }
  if (path === "/v1/toolsets") { res.end(JSON.stringify([{ enabled: unsafeTools, tools: ["terminal"] }])); return; }
  if (path === "/v1/skills") { res.end(JSON.stringify(unsafeSkills ? [{ name: "secret-reader" }] : [])); return; }
  if (path.endsWith("/stop")) { stops++; res.end('{"status":"stopping"}'); return; }
  if (req.method === "POST" && path === "/v1/runs") {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text) as Record<string, string>;
    const key = req.headers["idempotency-key"] as string;
    submissions.push({ path, key, body });
    let id = keys.get(key);
    if (!id) {
      id = `run_${runs.size + 1}`; keys.set(key, id);
      const input = JSON.parse(body.input);
      let output: object;
      if (body.instructions.includes("Peran Orkestrator")) output = { steps: illegalPlan ? ["shell"] : input.allowedSteps };
      else if (body.instructions.includes("Peran Kurator")) output = { standardId: badSource ? "invented" : input.standardId, unitCode: input.unitCode, excerptIndexes: [0] };
      else if (body.instructions.includes("Peran Anda Evaluator")) output = {
        response: "Umpan balik", evaluation: { score: 82, status: "needs_practice", strengths: ["Langkah jelas"],
          gaps: ["Periksa risiko"], evidenceChecklist: ["Catatan pemeriksaan"], nextStep: "Latihan" },
      };
      else if (body.instructions.includes("Peran Pelatih")) output = { response: "Perbaiki pemeriksaan risiko.", nextStep: "Susun daftar risiko." };
      else output = { question: "Bagaimana langkah kerja yang aman sesuai KUK?" };
      runs.set(id, { run_id: id, session_id: body.session_id, status: "completed", output: JSON.stringify(output) });
    }
    res.statusCode = 202; res.end(JSON.stringify({ run_id: id, status: "started" })); return;
  }
  const run = runs.get(path.split("/").at(-1)!);
  if (!run) { res.statusCode = 404; res.end("{}"); return; }
  if (oversized) { res.end(JSON.stringify({ output: "x".repeat(140000) })); return; }
  res.end(JSON.stringify({ ...run, ...(incomplete ? { status: "interrupted" } : {}),
    ...(hang ? { status: "running" } : {}), ...(wrongSession ? { session_id: "foreign" } : {}) }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;
// Transport injection forwards only the test's synthetic credentials to the local fixture.
const transport: typeof fetch = (url, init) => fetch(`http://127.0.0.1:${port}${new URL(String(url)).pathname}`, init);
const config = { baseUrl: "https://hermes.test", apiKey: "synthetic-contract-test", restrictedProfileVerified: true };
const runtime = new HermesRuntime(config, transport);
const role = catalog.roles.find(r => r.practiceAvailable)!;
const unit = catalog.units.find(u => u.standardId === role.standardId)!;
const context = getPracticeContext(role.id, unit.code)!;
const start: PracticeTurnInput = { action: "start", mode: "practice", roleId: role.id, unitCode: unit.code, history: [] };
const answer: PracticeTurnInput = { ...start, action: "answer", history: [{ role: "assistant", content: "Bagaimana langkah kerja?" }], answer: "Saya memeriksa risiko." };
const rejects = (fn: () => unknown, kind?: string) => assert.rejects(async () => fn(), e => e instanceof HermesError && (!kind || e.kind === kind));
try {
  assert.throws(() => new HermesRuntime({ ...config, apiKey: "" }), HermesError);
  for (const baseUrl of ["http://unsafe.test", "https://user:pass@test", "https://test?token=x", "https://test#x"]) {
    assert.throws(() => new HermesRuntime({ ...config, baseUrl }), HermesError);
  }
  assert.throws(() => new HermesRuntime({ ...config, restrictedProfileVerified: false }), HermesError);
  await runtime.preflight(AbortSignal.timeout(2000));
  unsafeTools = true; await rejects(() => runtime.preflight(AbortSignal.timeout(2000)), "unsafe"); unsafeTools = false;
  unsafeSkills = true; await rejects(() => runtime.preflight(AbortSignal.timeout(2000)), "unsafe"); unsafeSkills = false;

  const startResult = await executePracticeTurn(context, start, await createPracticeRuntime(start, "owner-A", { hermes: runtime }));
  assert.equal(startResult.agentRuns.filter(a => a.status === "complete").length, 3);
  assert.ok(startResult.agentRuns.filter(a => a.status === "complete").every(a => a.runtime === "hermes" && a.runId));
  assert.deepEqual(startResult.agentRuns.filter(a => a.status === "skipped").map(a => a.agentId), ["evaluator", "coach"]);
  const result = await executePracticeTurn(context, answer, await createPracticeRuntime(answer, "owner-A", { hermes: runtime, executionNamespace: "claimed-generation" }));
  assert.equal(result.agentRuns.filter(a => a.status === "complete" && a.runtime === "hermes").length, 5);
  assert.equal(result.evaluation?.status, "ready_for_practice", "Host, not model, imposes score/status threshold");
  assert.equal(result.evaluation?.nextStep, "Susun daftar risiko.");
  assert.equal(result.citations[0].unitCode, context.unit.code);
  assert.equal(result.citations[0].url, context.standard.sourceUrl);
  const count = runs.size;
  assert.deepEqual(await executePracticeTurn(context, answer, await createPracticeRuntime(answer, "owner-A", { hermes: runtime, executionNamespace: "claimed-generation" })), result);
  assert.equal(runs.size, count, "Exact retry must reuse all runs");
  await executePracticeTurn(context, start, await createPracticeRuntime(start, "owner-B", { hermes: runtime }));
  assert.equal(runs.size, count + 3, "Another participant must get distinct sessions and run keys");
  assert.notEqual(executionIdentity("owner-A", start), executionIdentity("owner-B", start));
  assert.ok(submissions.every(s => !JSON.stringify(s.body).includes("owner-A") && !JSON.stringify(s.body).includes("owner-B")));

  illegalPlan = true;
  await assert.rejects(executePracticeTurn(context, start, await createPracticeRuntime(start, "bad-plan-owner", { hermes: runtime })), /Invalid bounded plan/);
  illegalPlan = false; badSource = true;
  await assert.rejects(executePracticeTurn(context, start, await createPracticeRuntime(start, "bad-source-owner", { hermes: runtime })), /Untrusted source/);
  badSource = false;
  for (const mode of ["incomplete", "session", "oversized", "timeout"]) {
    incomplete = mode === "incomplete"; wrongSession = mode === "session"; oversized = mode === "oversized"; hang = mode === "timeout";
    const before = stops;
    await rejects(() => runtime.execute("examiner", "Bounded", {}, `failure-${mode}`, AbortSignal.timeout(mode === "timeout" ? 50 : 2000)));
    assert.equal(stops, before + 1, "Unsuccessful execution must request cancellation");
  }
  incomplete = wrongSession = oversized = hang = false;
  const legacy = structuredClone(result);
  for (const run of legacy.agentRuns) { delete run.runtime; delete run.runId; }
  assert.ok(CreatePracticeTurnResponse.safeParse(legacy).success, "Historical passport entries remain readable");
  console.log("Hermes HTTP contract, bounded stages, source integrity, cancellation, owner isolation and replay checks passed.");
} finally { server.closeAllConnections(); server.close(); }
