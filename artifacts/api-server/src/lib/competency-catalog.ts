import sourceUnits from "./competency-sources.json";
import importedCatalog from "./competency-import.json";
import { createHash } from "node:crypto";
import { GetCompetencyCatalogResponse, GetCompetencySummaryResponse } from "@workspace/api-zod";

export const agents = [
  { id: "orchestrator", name: "Orkestrator", responsibility: "Mengatur alur latihan dan membatasi tugas setiap agen." },
  { id: "standards", name: "Kurator Standar", responsibility: "Mengambil unit dan kriteria unjuk kerja dari dokumen rujukan." },
  { id: "examiner", name: "Asesor Simulasi", responsibility: "Menyusun pertanyaan kasus berdasarkan unit yang dipilih." },
  { id: "evaluator", name: "Evaluator", responsibility: "Membandingkan jawaban dengan kriteria rujukan dan menjelaskan kekurangan." },
  { id: "coach", name: "Pelatih", responsibility: "Menerjemahkan hasil evaluasi menjadi langkah latihan berikutnya." },
];

const processedStandards = [
  {
    id: "skkni-196-2021",
    title: "SKKNI Jabatan Kerja Arsitek",
    standardType: "SKKNI",
    code: "SKKNI 196-2021",
    year: 2021,
    registrationCode: null,
    sourceUrl: "https://skkni-api.kemnaker.go.id/v1/public/documents/ccc0dbf8-4f22-4cf7-aad2-fcc5c5897c04/download",
    status: "Perlu verifikasi pembaruan",
    statusNote: "Dokumen ditetapkan 30 Desember 2021 dan menyebut kaji ulang setiap 5 tahun atau sesuai kebutuhan. Status versi terbaru dan pemetaan skema per jenjang belum diverifikasi.",
  },
  {
    id: "skkk-36-2022",
    title: "SKKK Juru Gambar Arsitektur",
    standardType: "SKKK",
    code: "SKKK 36-2022",
    year: 2022,
    registrationCode: "36/SKPK-DG/2022",
    sourceUrl: "https://simkompetensi.com//public/uploads/file_skkk/1672821253-17SKKKJURUGAMBARARSITEKTUR.pdf",
    status: "Perlu verifikasi masa berlaku",
    statusNote: "Keputusan registrasi 8 November 2022 menyebut masa berlaku 3 tahun. Periode tersebut telah terlewati; perpanjangan, pengganti, dan skema jenjang terkini belum diverifikasi. Dipakai hanya sebagai rujukan latihan historis.",
  },
];

type Standard = ReturnType<typeof GetCompetencyCatalogResponse.parse>["standards"][number];
const standardsById = new Map<string, Standard>(processedStandards.map(standard => [standard.id, standard]));
const sourceLabels = new Map<string, Set<string>>();
for (const row of importedCatalog.records) {
  if (!row.sourceUrl) continue;
  const labels = sourceLabels.get(row.sourceUrl) ?? new Set<string>();
  labels.add(row.reportedStandard);
  sourceLabels.set(row.sourceUrl, labels);
}

function standardFor(row: (typeof importedCatalog.records)[number]) {
  const processed = processedStandards.find(standard => standard.sourceUrl === row.sourceUrl);
  if (processed) return processed.id;
  const id = `standar-${createHash("sha256").update(JSON.stringify([row.reportedStandard, row.sourceUrl])).digest("hex").slice(0, 16)}`;
  if (!standardsById.has(id)) {
    const years = [...new Set(row.reportedStandard.match(/\b(?:19|20)\d{2}\b/g) ?? [])];
    standardsById.set(id, {
      id, title: row.reportedStandard, code: row.reportedStandard,
      standardType: /^SKKNI\b/i.test(row.reportedStandard) ? "SKKNI" : /SKK\s*Khusus|SKKK/i.test(row.reportedStandard) ? "SKKK" : "Rujukan skema",
      year: years.length === 1 ? Number(years[0]) : null,
      registrationCode: null, sourceUrl: row.sourceUrl,
      status: row.sourceUrl ? "Dokumen belum diproses" : "Tautan sumber belum tersedia",
      statusNote: "Rujukan berasal dari katalog unggahan. Label Final/Sementara adalah metadata katalog, bukan hasil verifikasi aplikasi. Isi dokumen, status berlaku terkini, dan pemetaan skema per jenjang belum diverifikasi; latihan AI belum diaktifkan.",
    });
  }
  return id;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const roles = importedCatalog.records.map(row => {
  const standardId = standardFor(row);
  const unitCount = sourceUnits.filter(unit => unit.standardId === standardId).length;
  const reviewNotes = [...row.reviewNotes];
  if (row.sourceUrl && (sourceLabels.get(row.sourceUrl)?.size ?? 0) > 1) {
    reviewNotes.push("Tautan dokumen yang sama tercatat dengan beberapa nama standar berbeda. Perlu pemeriksaan sumber; tidak dikoreksi otomatis.");
  }
  const practiceAvailable = unitCount > 0 && row.reportedStandardStatus === "Final" && reviewNotes.length === 0;
  return {
    id: row.id, classificationId: slug(row.classificationName), family: row.family,
    title: row.title, qualification: row.qualification, level: row.level, standardId,
    subClassification: row.subClassification, reportedStandard: row.reportedStandard,
    reportedStandardStatus: row.reportedStandardStatus, pkbRequired: row.pkbRequired,
    mvpPhase: row.mvpPhase, practiceAvailable, reviewNotes, unitCount,
    readiness: practiceAvailable ? "Unit rujukan tersedia; pemetaan skema jenjang belum diverifikasi"
      : reviewNotes.length ? "Perlu tinjauan data/sumber; latihan AI belum tersedia"
      : "Dokumen dan unit belum diproses; latihan AI belum tersedia",
  };
});

export const catalog = GetCompetencyCatalogResponse.parse({
  classifications: [...new Set(importedCatalog.records.map(row => row.classificationName))].map(name => {
    const id = slug(name);
    const members = roles.filter(role => role.classificationId === id);
    const practiceRoleCount = members.filter(role => role.practiceAvailable).length;
    return {
      id, name, description: `${new Set(members.map(role => role.subClassification)).size} subklasifikasi dari katalog jabatan unggahan.`,
      available: members.length > 0, roleCount: members.length, practiceRoleCount,
      sourceStatus: practiceRoleCount > 0
        ? `${practiceRoleCount} entri memiliki unit rujukan untuk latihan; paket skema per jenjang belum diverifikasi`
        : "Katalog tersedia; dokumen dan unit belum diproses untuk latihan AI",
    };
  }),
  standards: [...standardsById.values()],
  roles,
  units: sourceUnits.map(({ excerpt: _excerpt, ...unit }) => unit),
});

export const summary = GetCompetencySummaryResponse.parse({
  classificationCount: catalog.classifications.length,
  roleCount: catalog.roles.length,
  unitCount: catalog.units.length,
  reviewCount: catalog.standards.length,
  agents,
});

export function getPracticeContext(roleId: string, unitCode: string) {
  const role = catalog.roles.find(role => role.id === roleId);
  const unit = sourceUnits.find(unit => unit.code === unitCode);
  const standard = catalog.standards.find(standard => standard.id === role?.standardId);
  if (!role || !role.practiceAvailable || !unit || !standard?.sourceUrl || unit.standardId !== standard.id) return null;
  return { role, unit, standard };
}
