import { Router, type IRouter } from "express";
import { CreatePracticeTurnBody } from "@workspace/api-zod";
import { catalog, summary, getPracticeContext } from "../lib/competency-catalog";
import { runPracticeTurn } from "../lib/competency-agents";
import { getAuth } from "@clerk/express";
import { prepareJournal, completeJournal, failJournal, type Journal } from "../lib/ujk-practice-journal";
import { UjkError } from "../lib/ujk-service";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

const router: IRouter = Router();
const usage = new Map<string, { count: number; resetAt: number }>();
let globalDay = "";
let globalCalls = 0;
let activeCalls = 0;

router.get("/competency/catalog", (_req, res) => { res.json(catalog); });
router.get("/competency/summary", (_req, res) => { res.json(summary); });

router.post("/agents/practice-turn", async (req, res): Promise<void> => {
  try {
    if (req.get("origin") && new URL(req.get("origin")!).host !== getClerkProxyHost(req)) {
      res.status(403).json({ error: "Asal permintaan tidak diizinkan." }); return;
    }
  } catch { res.status(403).json({ error: "Asal permintaan tidak diizinkan." }); return; }
  const parsed = CreatePracticeTurnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Masukan latihan tidak valid. Pilih jabatan dan unit kompetensi." });
    return;
  }
  const input = parsed.data;
  const context = getPracticeContext(input.roleId, input.unitCode);
  if (!context) {
    res.status(400).json({ error: "Unit rujukan belum tersedia untuk jabatan ini." });
    return;
  }
  if (input.action === "answer" && (!input.answer?.trim() || !input.history.some(message => message.role === "assistant"))) {
    res.status(400).json({ error: "Mulai sesi terlebih dahulu dan tulis jawaban Anda." });
    return;
  }
  if (input.history.reduce((total, message) => total + message.content.length, 0) > 35000) {
    res.status(400).json({ error: "Riwayat terlalu panjang. Mulai sesi baru untuk melanjutkan latihan." });
    return;
  }

  let journal: Journal | null = null;
  try {
    const prepared = await prepareJournal(input, getAuth(req).userId);
    if (prepared.cached) { res.json(prepared.cached); return; }
    journal = prepared.journal;
  } catch (error) {
    res.status(error instanceof UjkError ? error.status : 503).json({ error: error instanceof UjkError ? error.message : "Paspor belum dapat diakses. Coba kembali." });
    return;
  }
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== globalDay) { globalDay = day; globalCalls = 0; }
  for (const [key, value] of usage) if (value.resetAt <= now) usage.delete(key);
  const key = getAuth(req).userId ?? req.ip ?? req.socket.remoteAddress ?? "anonymous";
  const bucket = usage.get(key) ?? { count: 0, resetAt: now + 3600000 };
  if (bucket.count >= 20 || globalCalls >= 200 || activeCalls >= 3) {
    try { await failJournal(journal); } catch { /* Fail closed; do not invoke AI. */ }
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Batas latihan AI sementara tercapai. Coba kembali nanti." });
    return;
  }
  bucket.count++;
  usage.set(key, bucket);
  globalCalls++;
  activeCalls++;
  try {
    const result = await runPracticeTurn(context, input);
    await completeJournal(journal, input, result);
    res.json(result);
  } catch (error) {
    try { await failJournal(journal); } catch { /* Keep the attempt pending for safe recovery. */ }
    req.log.warn({ errorType: error instanceof Error ? error.name : "Unknown" }, "Competency AI request failed");
    res.status(503).json({ error: "Agen AI belum berhasil menyelesaikan permintaan. Jawaban Anda tidak dihapus; coba lagi nanti." });
  } finally {
    activeCalls--;
  }
});

export default router;
