import { createHash, randomUUID } from "node:crypto";

// Public contract: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
// No management, shell, approval, evidence, or database API is exposed to the model.
export class HermesError extends Error {
  constructor(public readonly kind: "not_configured" | "unavailable" | "unsafe") {
    super(`Hermes ${kind}`);
    this.name = "HermesError";
  }
}

type Config = { baseUrl: string; apiKey: string; restrictedProfileVerified: boolean };
type Transport = typeof fetch;
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HermesError("unavailable");
  return value as Json;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new HermesError("unavailable");
  return value;
}

export function hermesConfig(): Config {
  return {
    baseUrl: process.env.HERMES_BASE_URL ?? "",
    apiKey: process.env.HERMES_API_KEY ?? "",
    restrictedProfileVerified: process.env.HERMES_RESTRICTED_PROFILE_VERIFIED === "true",
  };
}

export function selectedRuntime(): "hermes" | "openai" {
  const selected = process.env.SIGAP_AGENT_RUNTIME ?? "openai";
  if (selected !== "openai" && selected !== "hermes") throw new HermesError("not_configured");
  return selected;
}

export class HermesRuntime {
  private readonly base: string;
  constructor(private readonly config: Config, private readonly transport: Transport = fetch) {
    if (!config.baseUrl || !config.apiKey) throw new HermesError("not_configured");
    let url: URL;
    try { url = new URL(config.baseUrl); } catch { throw new HermesError("not_configured"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new HermesError("unsafe");
    }
    // An operator must verify disabled shared memory/plugins/hooks on a dedicated profile.
    // Discovery below additionally checks the runtime's actual toolsets and skills.
    if (!config.restrictedProfileVerified) throw new HermesError("unsafe");
    this.base = url.href.replace(/\/$/, "");
  }

  private async request(path: string, signal: AbortSignal, body?: object, key?: string): Promise<unknown> {
    try {
      const response = await this.transport(`${this.base}${path}`, {
        method: body ? "POST" : "GET", redirect: "error", signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok || !response.body) throw new HermesError("unavailable");
      // Bound the body before parsing, including chunked responses.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 128 * 1024) throw new HermesError("unavailable");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof HermesError) throw error;
      throw new HermesError("unavailable"); // Never surface transport errors containing credentials/URLs.
    }
  }

  async preflight(signal: AbortSignal): Promise<void> {
    const [rawCapabilities, toolsets, skills] = await Promise.all([
      this.request("/v1/capabilities", signal),
      this.request("/v1/toolsets", signal),
      this.request("/v1/skills", signal),
    ]);
    const capabilities = object(rawCapabilities);
    const features = object(capabilities.features);
    const auth = object(capabilities.auth);
    if (capabilities.platform !== "hermes-agent" || auth.type !== "bearer" || auth.required !== true ||
      features.run_submission !== true || features.run_status !== true || features.run_stop !== true) {
      throw new HermesError("unsafe");
    }
    if (!Array.isArray(toolsets) || !Array.isArray(skills) || skills.length !== 0) throw new HermesError("unsafe");
    for (const raw of toolsets) {
      const toolset = object(raw);
      if (typeof toolset.enabled !== "boolean" || !Array.isArray(toolset.tools) ||
        toolset.tools.some(tool => typeof tool !== "string") ||
        (toolset.enabled && toolset.tools.length > 0)) throw new HermesError("unsafe");
    }
  }

  async execute(role: string, instructions: string, payload: object, executionKey: string, signal: AbortSignal) {
    // The caller's key includes an opaque server-owned owner scope, input fingerprint,
    // and policy version. No user/journey/attempt IDs or shared sessions reach Hermes.
    const key = createHash("sha256").update(JSON.stringify(["sigap-hermes-v1", executionKey, role, instructions, payload])).digest("hex");
    const sessionId = `sigap-${key}`;
    let runId: string | undefined;
    let complete = false;
    try {
      const submitted = object(await this.request("/v1/runs", signal, {
        session_id: sessionId, instructions, input: JSON.stringify(payload),
      }, key));
      runId = identifier(submitted.run_id);
      while (true) {
        signal.throwIfAborted();
        const run = object(await this.request(`/v1/runs/${runId}`, signal));
        if (run.run_id !== runId || run.session_id !== sessionId) throw new HermesError("unsafe");
        if (run.status === "completed") {
          if (typeof run.output !== "string" || run.output.length > 32000 ||
            run.error || run.error_code || run.finish_reason === "length") throw new HermesError("unavailable");
          const result = object(JSON.parse(run.output));
          complete = true;
          return { result, runId };
        }
        if (run.status !== "running" && run.status !== "started" && run.status !== "queued" && run.status !== "pending") {
          throw new HermesError("unavailable");
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new HermesError("unavailable")); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 400);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
    } catch (error) {
      if (error instanceof HermesError) throw error;
      throw new HermesError("unavailable");
    } finally {
      if (runId && !complete) {
        // Independent short deadline: the turn's deadline may already have expired.
        await this.request(`/v1/runs/${runId}/stop`, AbortSignal.timeout(3000), {}).catch(() => {});
      }
    }
  }
}

// Anonymous calls get distinct scopes. Authenticated callers pass an opaque per-owner scope.
export function executionIdentity(ownerScope: string, input: object): string {
  return createHash("sha256").update(JSON.stringify([ownerScope, input])).digest("hex");
}
export const anonymousScope = () => randomUUID();

async function inspectRuntimeStatus() {
  const checkedAt = new Date().toISOString();
  const config = hermesConfig();
  const hermesConfigured = !!(config.baseUrl && config.apiKey);
  let selected: "openai" | "hermes" = "hermes";
  try {
    selected = selectedRuntime();
    if (selected === "openai") return {
      selected, status: "ready" as const, checkedAt, hermesConfigured,
      message: "OpenAI melalui Replit AI Integrations dipilih. Hermes belum digunakan; status koneksinya belum diperiksa.",
    };
    const runtime = new HermesRuntime(config);
    await runtime.preflight(AbortSignal.timeout(5000));
    return { selected, status: "ready" as const, checkedAt, hermesConfigured,
      message: "API Hermes terjangkau dan pemeriksaan pembatasan alat lulus. Keberhasilan agen ditentukan per eksekusi." };
  } catch (error) {
    const status = error instanceof HermesError ? error.kind : "unavailable";
    const messages = {
      not_configured: "Hermes dipilih tetapi konfigurasi layanan belum lengkap. Tidak ada fallback ke OpenAI.",
      unsafe: "Hermes ditolak: kontrak API atau pembatasan profil belum memenuhi syarat keamanan.",
      unavailable: "Layanan Hermes belum dapat diverifikasi. Tidak ada fallback ke OpenAI.",
    };
    return { selected, status, checkedAt, hermesConfigured, message: messages[status] };
  }
}

// Public status polling must not amplify traffic to the private runtime.
// This cache is ONLY for display. Execution always performs fresh preflight checks.
let pendingStatus: Promise<Awaited<ReturnType<typeof inspectRuntimeStatus>>> | undefined;
let statusExpiresAt = 0;
export function getRuntimeStatus() {
  if (!pendingStatus || Date.now() >= statusExpiresAt) {
    statusExpiresAt = Date.now() + 15000;
    pendingStatus = inspectRuntimeStatus();
  }
  return pendingStatus;
}
