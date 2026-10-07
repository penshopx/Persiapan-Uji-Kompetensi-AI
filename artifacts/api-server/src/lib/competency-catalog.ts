import sourceUnits from "./competency-sources.json";
import { GetCompetencyCatalogResponse, GetCompetencySummaryResponse } from "@workspace/api-zod";

export const agents = [
  { id: "orchestrator", name: "Orkestrator", responsibility: "Mengatur alur latihan dan membatasi tugas setiap agen." },
  { id: "standards", name: "Kurator Standar", responsibility: "Mengambil unit dan kriteria unjuk kerja dari dokumen rujukan." },
  { id: "examiner", name: "Asesor Simulasi", responsibility: "Menyusun pertanyaan kasus berdasarkan unit yang dipilih." },
  { id: "evaluator", name: "Evaluator", responsibility: "Membandingkan jawaban dengan kriteria rujukan dan menjelaskan kekurangan." },
  { id: "coach", name: "Pelatih", responsibility: "Menerjemahkan hasil evaluasi menjadi langkah latihan berikutnya." },
];

const standards = [
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

const roleRows = [
  ["asisten-arsitek", "Asisten Arsitek", "Asisten Arsitek", "Ahli", 7, "skkni-196-2021"],
  ["arsitek-madya", "Arsitek", "Arsitek Madya", "Ahli", 8, "skkni-196-2021"],
  ["arsitek-utama", "Arsitek", "Arsitek Utama", "Ahli", 9, "skkni-196-2021"],
  ["asisten-arsitek-freshgraduate", "Asisten Arsitek (Freshgraduate)", "Asisten Arsitek (Freshgraduate)", "Ahli", 7, "skkni-196-2021"],
  ["asisten-pemula-arsitek", "Asisten Pemula Arsitek", "Asisten Pemula Arsitek", "Teknisi/Analis", 6, "skkni-196-2021"],
  ["juru-gambar-level-2", "Juru Gambar Arsitektur", "Juru Gambar Arsitektur Level 2", "Operator", 2, "skkk-36-2022"],
  ["juru-gambar-level-3", "Juru Gambar Arsitektur", "Juru Gambar Arsitektur Level 3", "Operator", 3, "skkk-36-2022"],
  ["juru-gambar-muda", "Juru Gambar Arsitektur", "Juru Gambar Arsitektur Muda", "Teknisi/Analis", 4, "skkk-36-2022"],
] as const;

export const catalog = GetCompetencyCatalogResponse.parse({
  classifications: [
    { id: "arsitektur", name: "Arsitektur", description: "Arsitektural: perancangan, praktik arsitek, dan penggambaran.", available: true, roleCount: 8, sourceStatus: "2 dokumen rujukan; paket skema per jenjang belum diverifikasi" },
    { id: "sipil", name: "Sipil", description: "Kerangka untuk jabatan dan unit kompetensi pekerjaan sipil.", available: false, roleCount: 0, sourceStatus: "Menunggu daftar jabatan dan dokumen standar" },
    { id: "mekanikal", name: "Mekanikal", description: "Kerangka untuk jabatan dan unit kompetensi pekerjaan mekanikal.", available: false, roleCount: 0, sourceStatus: "Menunggu daftar jabatan dan dokumen standar" },
    { id: "tata-lingkungan", name: "Tata Lingkungan", description: "Kerangka untuk jabatan dan unit kompetensi tata lingkungan.", available: false, roleCount: 0, sourceStatus: "Menunggu daftar jabatan dan dokumen standar" },
  ],
  standards,
  roles: roleRows.map(([id, family, title, qualification, level, standardId]) => ({
    id, classificationId: "arsitektur", family, title, qualification, level, standardId,
    unitCount: sourceUnits.filter(unit => unit.standardId === standardId).length,
    readiness: "Unit rujukan tersedia; pemetaan skema jenjang belum diverifikasi",
  })),
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
  if (!role || !unit || !standard || unit.standardId !== standard.id) return null;
  return { role, unit, standard };
}
