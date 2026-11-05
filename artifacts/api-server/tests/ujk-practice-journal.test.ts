import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, ujkJourneys, ujkEvents, ujkAttempts } from "@workspace/db";
import { prepareJournal, completeJournal, failJournal } from "../src/lib/ujk-practice-journal";
import { catalog, getPracticeContext } from "../src/lib/competency-catalog";
import { CreatePracticeTurnResponse, type PracticeTurnInput } from "@workspace/api-zod";
import { UjkError } from "../src/lib/ujk-service";
import { HermesRuntime } from "../src/lib/hermes-runtime";
import { createPracticeRuntime } from "../src/lib/competency-runtime";
import { executePracticeTurn } from "../src/lib/competency-agents";

// Everything, including append-only events, is rolled back. No participant records are used.
const rollback = new Error("ROLLBACK_TEST_FIXTURES");
try {
  await db.transaction(async tx => {
    const owner = `contract-test-${randomUUID()}`;
    const role = catalog.roles.find(r => r.practiceAvailable)!;
    const unit = catalog.units.find(u => u.standardId === role.standardId)!;
    const [journey] = await tx.insert(ujkJourneys).values({ ownerId: owner, roleId: role.id, unitCodes: [unit.code] }).returning();
    const input: PracticeTurnInput = { journeyId: journey.id, attemptId: randomUUID(), roleId: role.id, unitCode: unit.code,
      action: "answer", mode: "practice", history: [{ role: "assistant", content: "Pertanyaan?" }], answer: "Jawaban latihan." };
    const result = CreatePracticeTurnResponse.parse({
      response: "Umpan balik", question: "Pertanyaan berikutnya?",
      evaluation: { score: 60, status: "developing", strengths: [], gaps: ["Risiko"], evidenceChecklist: [], nextStep: "Berlatih" },
      citations: [{ standardId: role.standardId, title: "Rujukan", url: "https://example.org/standard", unitCode: unit.code, note: "Latihan" }],
      agentRuns: [{ agentId: "evaluator", agentName: "Evaluator", responsibility: "Umpan balik", status: "complete", runtime: "hermes", runId: "run_test" }],
    });
    const expectStatus = (status: number) => (e: unknown) => e instanceof UjkError && e.status === status;
    await assert.rejects(prepareJournal(input, null, tx), expectStatus(401));
    await assert.rejects(prepareJournal(input, `${owner}-other`, tx), expectStatus(404));
    const prepared = await prepareJournal(input, owner, tx);
    assert.ok(prepared.journal); assert.equal(prepared.cached, null);
    await assert.rejects(prepareJournal(input, owner, tx), expectStatus(409));
    await assert.rejects(prepareJournal({ ...input, answer: "Changed" }, owner, tx), expectStatus(409));
    await completeJournal(prepared.journal, input, result, tx);
    const replay = await prepareJournal(input, owner, tx);
    assert.equal(replay.journal, null); assert.deepEqual(replay.cached, result);
    const events = await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id));
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].payload.result, result, "Passport preserves runtime/run metadata");
    await assert.rejects(completeJournal(prepared.journal, input, result, tx), expectStatus(409));
    await failJournal(prepared.journal, tx);
    const [attempt] = await tx.select().from(ujkAttempts).where(eq(ujkAttempts.id, input.attemptId!));
    assert.equal(attempt.state, "complete", "A late failure cannot overwrite a completed result");
    const failedInput = { ...input, attemptId: randomUUID() };
    const failed = await prepareJournal(failedInput, owner, tx);
    await failJournal(failed.journal, tx);
    const retry = await prepareJournal(failedInput, owner, tx);
    assert.ok(retry.journal);
    assert.notEqual(retry.journal.executionId, failed.journal!.executionId);
    await failJournal(failed.journal, tx);
    await assert.rejects(completeJournal(failed.journal, failedInput, result, tx), expectStatus(409));
    await assert.rejects(prepareJournal(failedInput, owner, tx), expectStatus(409), "Stale worker cannot release the new pending generation");
    await completeJournal(retry.journal, failedInput, result, tx);
    assert.equal((await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id))).length, 2);

    // Exercise the same prepare -> runtime -> complete/fail sequence as the route.
    // The fixture retains failed/invalid runs by key, like Hermes' 24-hour ledger.
    let upstreamMode = "healthy";
    const upstreamRuns = new Map<string, { run_id: string; session_id: string; status: string; output: string }>();
    const upstreamKeys = new Map<string, string>();
    let runtimeCalls = 0;
    const transport: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
      if (path === "/v1/capabilities") return json({ platform: "hermes-agent", auth: { type: "bearer", required: true },
        features: { run_submission: true, run_status: true, run_stop: true } });
      if (path === "/v1/toolsets" || path === "/v1/skills") return json([]);
      if (path.endsWith("/stop")) return json({ status: "stopping" });
      if (path === "/v1/runs" && init?.method === "POST") {
        runtimeCalls++;
        const key = new Headers(init.headers).get("Idempotency-Key")!;
        let id = upstreamKeys.get(key);
        if (!id) {
          id = `run_${upstreamRuns.size + 1}`;
          const body = JSON.parse(String(init.body));
          const payload = JSON.parse(body.input);
          let output: unknown;
          if (body.instructions.includes("Peran Orkestrator")) output = { steps: upstreamMode === "invalid" ? ["shell"] : payload.allowedSteps };
          else if (body.instructions.includes("Peran Kurator")) output = { standardId: payload.standardId, unitCode: payload.unitCode, excerptIndexes: [0] };
          else if (body.instructions.includes("Peran Anda Evaluator")) output = { response: result.response, evaluation: result.evaluation };
          else if (body.instructions.includes("Peran Pelatih")) output = { response: result.response, nextStep: result.evaluation!.nextStep };
          else output = { question: result.question };
          upstreamKeys.set(key, id);
          upstreamRuns.set(id, { run_id: id, session_id: body.session_id, status: upstreamMode === "failed" ? "failed" : "completed", output: JSON.stringify(output) });
        }
        return json({ run_id: id, status: "started" });
      }
      return json(upstreamRuns.get(path.split("/").at(-1)!));
    };
    const hermes = new HermesRuntime({ baseUrl: "https://hermes.test", apiKey: "synthetic-test-only", restrictedProfileVerified: true }, transport);
    const context = getPracticeContext(role.id, unit.code)!;
    const practiceTurn = async (turn: typeof input) => {
      const prepared = await prepareJournal(turn, owner, tx);
      if (prepared.cached) return prepared.cached;
      const claim = prepared.journal!;
      try {
        const runtime = await createPracticeRuntime(turn, owner, { hermes, executionNamespace: claim.executionId });
        const response = await executePracticeTurn(context, turn, runtime);
        await completeJournal(claim, turn, response, tx);
        return response;
      } catch (error) { await failJournal(claim, tx); throw error; }
    };
    for (const failure of ["failed", "invalid"]) {
      const turn = { ...input, attemptId: randomUUID() };
      const beforeEvents = (await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id))).length;
      upstreamMode = failure;
      await assert.rejects(practiceTurn(turn));
      const [failedClaim] = await tx.select().from(ujkAttempts).where(eq(ujkAttempts.id, turn.attemptId));
      assert.equal(failedClaim.state, "failed");
      upstreamMode = "healthy";
      const recovered = await practiceTurn(turn); // Same attempt ID, input, participant.
      const [recoveredClaim] = await tx.select().from(ujkAttempts).where(eq(ujkAttempts.id, turn.attemptId));
      assert.notEqual(recoveredClaim.executionId, failedClaim.executionId);
      assert.equal(recoveredClaim.state, "complete");
      assert.equal(recovered.agentRuns.filter(a => a.status === "complete").length, 5);
      const calls = runtimeCalls;
      assert.deepEqual(await practiceTurn(turn), recovered);
      assert.equal(runtimeCalls, calls, "Completed passport replay must not invoke Hermes");
      assert.equal((await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id))).length, beforeEvents + 1);
    }
    const staleInput = { ...input, attemptId: randomUUID() };
    const stale = await prepareJournal(staleInput, owner, tx);
    await tx.update(ujkAttempts).set({ createdAt: new Date(Date.now() - 700000) }).where(eq(ujkAttempts.id, stale.journal!.attemptId));
    assert.ok((await prepareJournal(staleInput, owner, tx)).journal, "An expired pending claim may be reclaimed");
    await assert.rejects(prepareJournal(staleInput, owner, tx), expectStatus(409), "Only the first claimant may reclaim a stale attempt");
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await pool.end(); }
console.log("Transactional passport ownership, runtime persistence, replay, conflicts and failed-attempt recovery verified; fixtures rolled back.");
