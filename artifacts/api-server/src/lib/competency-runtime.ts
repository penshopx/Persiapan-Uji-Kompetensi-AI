import type { PracticeTurnInput } from "@workspace/api-zod";
import { agents } from "./competency-catalog";
import { HermesRuntime, hermesConfig, selectedRuntime, executionIdentity, anonymousScope } from "./hermes-runtime";

type AgentId = (typeof agents)[number]["id"];
export type AgentRun = {
  agentId: string; agentName: string; responsibility: string;
  status: "complete" | "skipped"; runtime: "openai" | "hermes" | "local"; runId?: string;
};
export type AgentCall = (role: AgentId, system: string, payload: object) => Promise<Record<string, unknown>>;

export async function createPracticeRuntime(input: PracticeTurnInput, ownerScope?: string, options: { hermes?: HermesRuntime; signal?: AbortSignal; executionNamespace?: string } = {}) {
  const selected = options.hermes ? "hermes" : selectedRuntime();
  const signal = options.signal ?? AbortSignal.timeout(150000); // Whole turn, not 150 seconds for each agent.
  const hermes = options.hermes ?? (selected === "hermes" ? new HermesRuntime(hermesConfig()) : null);
  if (hermes) await hermes.preflight(AbortSignal.any([signal, AbortSignal.timeout(5000)]));
  // Journal retries rotate a persisted generation under an atomic pending claim.
  // Non-journal requests have no completed-result replay contract and get a fresh
  // namespace per request (including authenticated generic practice).
  const executionKey = executionIdentity(ownerScope ?? anonymousScope(), {
    input, executionNamespace: options.executionNamespace ?? anonymousScope(),
  });
  const runs: AgentRun[] = [];
  const record = (id: AgentId, runtime: AgentRun["runtime"], runId?: string) => {
    const agent = agents.find(a => a.id === id);
    if (!agent) throw new Error("Unknown specialist");
    runs.push({ agentId: id, agentName: agent.name, responsibility: agent.responsibility,
      status: "complete", runtime, ...(runId ? { runId } : {}) });
  };
  const call: AgentCall = async (role, system, payload) => {
    signal.throwIfAborted();
    if (hermes) {
      const { result, runId } = await hermes.execute(role, system, payload, executionKey, signal);
      record(role, "hermes", runId);
      return result;
    }
    // Lazy import: a Hermes-only installation must not require OpenAI credentials.
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini", max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
    }, { signal, timeout: 90000, maxRetries: 0 });
    const choice = completion.choices[0];
    if (choice?.finish_reason !== "stop" || !choice.message.content || choice.message.content.length > 32000) {
      throw new Error("Incomplete specialist output");
    }
    const result: unknown = JSON.parse(choice.message.content);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid specialist output");
    record(role, "openai");
    return result as Record<string, unknown>;
  };
  return {
    call, selected,
    local: (id: AgentId) => record(id, "local"),
    finish: () => agents.map(agent => runs.find(run => run.agentId === agent.id) ?? {
      agentId: agent.id, agentName: agent.name, responsibility: agent.responsibility,
      status: "skipped" as const, runtime: selected,
    }),
  };
}
export type PracticeRuntime = Awaited<ReturnType<typeof createPracticeRuntime>>;
