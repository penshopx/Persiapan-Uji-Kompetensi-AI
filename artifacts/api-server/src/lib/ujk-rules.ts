export const PRACTICE_THRESHOLD = 75;

type ReadinessUnit = {
  learned: boolean;
  lastScore: number | null;
  reviewedEvidenceCount: number;
  safetyCritical: boolean;
};

export function determineReadiness(units: ReadinessUnit[], safetyPassed: boolean, schemeVerified: boolean, simulationPassed: boolean) {
  const blockers: string[] = [];
  const unlearned = units.filter(unit => !unit.learned).length;
  const weak = units.filter(unit => unit.lastScore === null || unit.lastScore < PRACTICE_THRESHOLD).length;
  const missingEvidence = units.filter(unit => unit.reviewedEvidenceCount === 0).length;
  const safetyUnitFailed = units.some(unit => unit.safetyCritical && (unit.lastScore === null || unit.lastScore < PRACTICE_THRESHOLD));
  if (!units.length) blockers.push("Paket unit sumber belum tersedia.");
  if (unlearned) blockers.push(`${unlearned} unit belum ditandai dipelajari dalam asesmen mandiri.`);
  if (!safetyPassed) blockers.push("Gerbang K3 internal belum lulus seluruh pertanyaan. Nilai rata-rata tidak dapat menggantikannya.");
  if (safetyUnitFailed) blockers.push("Unit rujukan SMKK belum mencapai ambang latihan internal.");
  if (weak) blockers.push(`${weak} unit belum memiliki jawaban latihan pada atau di atas ambang internal ${PRACTICE_THRESHOLD}.`);
  if (missingEvidence) blockers.push(`${missingEvidence} unit belum memiliki bukti yang diterima reviewer manusia; deklarasi peserta saja tidak cukup.`);
  if (!schemeVerified) blockers.push("Paket unit wajib dalam skema jabatan/jenjang belum diverifikasi. Daftar saat ini hanya unit rujukan.");
  if (!simulationPassed) blockers.push("Simulasi asesor belum ditinjau dan dinyatakan selesai oleh reviewer manusia.");
  const status = !units.length || unlearned > 0 || !safetyPassed || safetyUnitFailed ? "belum_siap"
    : blockers.length ? "perlu_perbaikan" : "siap_diajukan";
  return { status, blockers } as const;
}

export const safetyQuestions = [
  {
    id: "ibprp", question: "Kondisi lokasi kerja berbeda dari pekerjaan sebelumnya. Apa langkah awal penerapan keselamatan?",
    choices: ["Menyalin penilaian risiko proyek sebelumnya tanpa pemeriksaan", "Menginterpretasikan IBPRP berdasarkan AKK sesuai kondisi lapangan pekerjaan", "Langsung bekerja karena alat pelindung sudah tersedia"],
    correct: 1, sourceNote: "Rujukan latihan historis F.41JGA00.001.1, KUK 1.1: IBPRP berdasarkan AKK sesuai kondisi lapangan. Bukan paket skema atau ujian resmi.",
  },
  {
    id: "apd", question: "Sebelum memakai APD dan APK, tindakan mana yang diperlukan?",
    choices: ["Memilih sesuai ketentuan dan memeriksa kelaikannya berdasarkan standar", "Menggunakan yang tersedia tanpa pemeriksaan", "Mengganti pemeriksaan dengan pengalaman pribadi"],
    correct: 0, sourceNote: "Rujukan latihan historis F.41JGA00.001.1, KUK 1.2–1.3: pemilihan serta pemeriksaan kelaikan APD dan APK.",
  },
  {
    id: "implementation", question: "Saat melaksanakan pekerjaan, bagaimana hasil analisis keselamatan diterapkan?",
    choices: ["Menyimpan hasil analisis sebagai arsip saja", "Menggunakan APD tanpa menerapkan pengendalian risiko", "Menerapkan hasil IBPRP berdasarkan AKK dalam lingkup kerja serta menggunakan APD/APK sesuai ketentuan"],
    correct: 2, sourceNote: "Rujukan latihan historis F.41JGA00.001.1, KUK 2.1–2.2. Status berlaku terkini SKKK 36-2022 masih perlu verifikasi.",
  },
];
