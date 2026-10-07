import { Router, type IRouter } from "express";
import { CreatePracticeTurnBody } from "@workspace/api-zod";
import { catalog, summary, getPracticeContext } from "../lib/competency-catalog";
import { runPracticeTurn } from "../lib/competency-agents";

const router: IRouter = Router();
const usage = new Map<string, { count: number; resetAt: number }>();
let globalDay = "";
let globalCalls = 0;
let activeCalls = 0;

router.get("/competency/catalog", (_req, res) => { res.json(catalog); });
router.get("/competency/summary", (_req, res) => { res.json(summary); });

router.post("/agents/practice-turn", async (req, res): Promise<void> => {
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

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== globalDay) { globalDay = day; globalCalls = 0; }
  for (const [key, value] of usage) if (value.resetAt <= now) usage.delete(key);
  const key = req.ip ?? req.socket.remoteAddress ?? "anonymous";
  const bucket = usage.get(key) ?? { count: 0, resetAt: now + 3600000 };
  if (bucket.count >= 20 || globalCalls >= 200 || activeCalls >= 3) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Batas latihan AI sementara tercapai. Coba kembali nanti." });
    return;
  }
  bucket.count++;
  usage.set(key, bucket);
  globalCalls++;
  activeCalls++;
  try {
    res.json(await runPracticeTurn(context, input));
  } catch (error) {
    req.log.warn({ errorType: error instanceof Error ? error.name : "Unknown" }, "Competency AI request failed");
    res.status(503).json({ error: "Agen AI belum berhasil menyelesaikan permintaan. Jawaban Anda tidak dihapus; coba lagi nanti." });
  } finally {
    activeCalls--;
  }
});

export default router;
