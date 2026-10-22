import { Router } from "express";
import { Readable } from "node:stream";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, ujkUploads } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { assignedJourney } from "../lib/ujk-review-access";

const router = Router();
const storage = new ObjectStorageService();

router.get("/storage/public-objects/*filePath", async (req, res) => {
  try {
    const raw = req.params.filePath;
    const file = await storage.searchPublicObject(Array.isArray(raw) ? raw.join("/") : raw);
    if (!file) { res.status(404).json({ error: "Berkas tidak ditemukan." }); return; }
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).on("error", () => res.destroy()).pipe(res);
    else res.end();
  } catch {
    res.status(503).json({ error: "Berkas belum dapat diakses." });
  }
});

router.get("/storage/objects/*path", async (req, res) => {
  try {
    const owner = getAuth(req).userId;
    if (!owner) { res.status(401).json({ error: "Masuk untuk mengakses bukti pribadi." }); return; }
    if (req.get("origin") && new URL(req.get("origin")!).host !== getClerkProxyHost(req)) {
      res.status(403).json({ error: "Asal permintaan tidak diizinkan." }); return;
    }
    const raw = req.params.path;
    const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
    const [evidence] = await db.select().from(ujkUploads).where(and(eq(ujkUploads.objectPath, objectPath), eq(ujkUploads.finalized, true)));
    if (!evidence) { res.status(404).json({ error: "Bukti tidak ditemukan." }); return; }
    if (evidence.ownerId !== owner) {
      try { await assignedJourney(evidence.journeyId, owner); }
      catch { res.status(404).json({ error: "Bukti tidak ditemukan." }); return; }
    }
    const file = await storage.getObjectEntityFile(objectPath);
    // Reviewer grant is checked live above, never written into an enduring object ACL.
    if (!await storage.canAccessObjectEntity({ userId: evidence.ownerId, objectFile: file, requestedPermission: ObjectPermission.READ })) {
      res.status(404).json({ error: "Bukti tidak ditemukan." }); return;
    }
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="bukti"; filename*=UTF-8''${encodeURIComponent(evidence.fileName)}`);
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).on("error", () => res.destroy()).pipe(res);
    else res.end();
  } catch (error) {
    res.status(error instanceof ObjectNotFoundError ? 404 : 503).json({ error: "Bukti belum dapat diakses." });
  }
});

export default router;
