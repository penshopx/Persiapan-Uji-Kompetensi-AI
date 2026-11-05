import { createHash } from "node:crypto";
import type { UjkJourneyDetail } from "@workspace/api-zod";

export const PACKAGE_NOTE = "Paket persiapan UJK, bukan sertifikat dan bukan keputusan K/BK. Keputusan kompetensi hanya oleh LSP. Tidak dikirim otomatis kepada LSP. Status adalah snapshot historis, bukan jaminan kesiapan saat paket dibaca.";
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

type ReviewEvent = { id: number; kind: string; unitCode: string | null; createdAt: Date; payload: Record<string, unknown> };
export function packageManifest(detail: UjkJourneyDetail, selected: string[], events: ReviewEvent[], snapshotAt: Date, exportId: string) {
  const ids = new Set(selected);
  const evidence = detail.evidence.filter(e => ids.has(e.id)).map(({ downloadUrl: _url, ...e }) => e);
  // Do not include unselected evidence metadata, review reasons, object paths, or download links.
  const reviewerHistory = events.filter(e =>
    ["reviewer_assignment", "review_consent", "simulation_review"].includes(e.kind) ||
    (e.kind === "evidence_review" && ids.has(String(e.payload.evidenceId))),
  ).map(e => ({ ...e, createdAt: e.createdAt.toISOString() }));
  const missingEvidenceUnitCodes = detail.requiredUnitCodes.filter(code =>
    !evidence.some(e => e.unitCode === code && e.reviewStatus === "accepted"));
  const { decisions: _decisions, ...review } = detail.review;
  return {
    formatVersion: 1, exportId, snapshotAt: snapshotAt.toISOString(), note: PACKAGE_NOTE,
    consent: { approved: true, evidenceIds: selected, scope: "Snapshot kesiapan, unit, riwayat reviewer terkait, laporan simulasi dan berkas terpilih; penyerahan manual oleh peserta." },
    readiness: { ...detail.journey, blockers: detail.blockers, threshold: detail.threshold, simulationPassed: detail.simulationPassed },
    scheme: detail.scheme, requiredUnitCodes: detail.requiredUnitCodes,
    units: detail.units, evidence, reviewerHistory, simulation: review,
    packageCompleteness: { missingEvidenceUnitCodes, allRequiredUnitsHaveSelectedAcceptedEvidence: detail.journey.schemeVerified && missingEvidenceUnitCodes.length === 0 },
    ruleNote: detail.ruleNote, schemeNote: detail.schemeNote,
  };
}

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const escape = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function packageReport(manifest: ReturnType<typeof packageManifest>) {
  return `<!doctype html><html lang="id"><meta charset="utf-8"><title>Paket persiapan UJK</title>
<style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:20px;color:#152239;background:#fff}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bcc8d6;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}aside{background:#e8f2ff;padding:16px}</style>
<h1>Paket persiapan UJK</h1><aside>${escape(PACKAGE_NOTE)}</aside>
<p>Snapshot: ${escape(manifest.snapshotAt)} · ID: ${escape(manifest.exportId)}</p>
<h2>Kesiapan pada saat ekspor</h2><p>${escape(manifest.readiness.title)} — ${escape(manifest.readiness.status)}</p>
<ul>${manifest.readiness.blockers.map(b => `<li>${escape(b)}</li>`).join("")}</ul>
<h2>Skema dan unit wajib terverifikasi</h2><p>${escape(manifest.schemeNote)}</p>
<pre>${escape(JSON.stringify(manifest.scheme, null, 2))}</pre>
<table><tr><th>Kode</th><th>Unit wajib</th><th>Skor internal</th></tr>${manifest.units.filter(u => manifest.requiredUnitCodes.includes(u.code)).map(u => `<tr><td>${escape(u.code)}</td><td>${escape(u.title)}</td><td>${escape(u.lastScore)}</td></tr>`).join("")}</table>
<h2>Bukti yang dipilih</h2><p>${manifest.evidence.length} berkas. Unit wajib tanpa bukti terpilih yang diterima: ${escape(manifest.packageCompleteness.missingEvidenceUnitCodes.join(", ") || "tidak ada")}. Jumlah ini berbeda dari kesiapan seluruh paspor.</p>
<pre>${escape(JSON.stringify(manifest.evidence, null, 2))}</pre>
<h2>Riwayat reviewer terkait</h2><pre>${escape(JSON.stringify(manifest.reviewerHistory, null, 2))}</pre>
<h2>Laporan simulasi dan rekaman latihan</h2><pre>${escape(JSON.stringify(manifest.simulation, null, 2))}</pre>
<h2>Aturan internal</h2><p>${escape(manifest.ruleNote)}</p>
<p>Rincian snapshot dan checksum masing-masing berkas tersedia pada manifest.json. Periksa SHA-256 ZIP terhadap nilai pada aplikasi sebelum menyerahkan. Salinan yang sudah diunduh tidak dapat ditarik kembali.</p></html>`;
}

// ZIP "store" format: bounded, no dependency and no compression bomb risk.
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function makePackageZip(entries: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(entry.name) || entry.name.includes("..") || entry.name.startsWith("/")) throw new Error("Unsafe ZIP entry");
    const name = Buffer.from(entry.name), crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(33, 14); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(entry.data.length, 20); dir.writeUInt32LE(entry.data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...locals, directory, end]);
  if (result.length > MAX_PACKAGE_BYTES) throw new Error("Package exceeds limit");
  return result;
}
