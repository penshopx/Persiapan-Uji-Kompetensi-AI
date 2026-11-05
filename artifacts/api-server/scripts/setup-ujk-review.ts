import { and, eq, sql } from "drizzle-orm";
import { db, pool, ujkSchemes } from "@workspace/db";
import { catalog } from "../src/lib/competency-catalog";

// Fixed research provenance, not invented verification. No network dependency at merge.
const checkedAt = new Date("2026-10-10T00:00:00Z");
const sarsiUrl = "https://lsp-sarsi.id/skema%20SKK%20Arsitek.pdf";
const sarsiHash = "b6059ffc3877cd8aa28efc2e1589874736ef02bcef3bd3227dcbd45e93670b60";
const drawingUrl = "https://simkompetensi.com//public/uploads/file_skkk/1672821253-17SKKKJURUGAMBARARSITEKTUR.pdf";
const drawingHash = "1d1f12fa49500e2db5d3034874706a3136ca5e89c7fc5129c0627250ff5d5d5e";
const candidates: Record<string, number[]> = {
  "arsitek-utama": [1, 2, 3, 4, 5, 6, 7, 8], "arsitek-madya": [1, 2, 3, 4, 5, 6, 7, 8],
  "asisten-arsitek": [1, 3, 4, 5, 6, 8], "asisten-pemula-arsitek": [3, 4, 5, 6],
};

try {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(740041)`);
    await tx.execute(sql`
      CREATE OR REPLACE FUNCTION ujk_reject_audit_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'UJK audit records are append-only'; END $$;
    `);
    for (const table of ["ujk_events", "ujk_schemes", "ujk_notifications"]) {
      // Identifiers are fixed constants above, never user input.
      await tx.execute(sql.raw(`DROP TRIGGER IF EXISTS ujk_append_only ON ${table}; CREATE TRIGGER ujk_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ujk_reject_audit_mutation();`));
    }
    for (const role of catalog.roles.filter(r => r.practiceAvailable)) {
      const arsitek = role.standardId === "skkni-196-2021";
      const sourceUrl = arsitek ? sarsiUrl : drawingUrl;
      const sourceHash = arsitek ? sarsiHash : drawingHash;
      const [exists] = await tx.select().from(ujkSchemes).where(and(eq(ujkSchemes.roleId, role.id), eq(ujkSchemes.checkedBy, "source-research")));
      if (exists) continue;
      const numbers = candidates[role.id];
      await tx.insert(ujkSchemes).values({
        roleId: role.id, level: role.level, version: arsitek ? "PDF publik SARSI tanpa nomor revisi" : "SKKK 36/SKPK-DG/2022; bukan skema jenjang",
        authority: arsitek ? "LSP SARSI / BNSP (penelusuran, bukan persetujuan)" : "Direktorat Jenderal Bina Konstruksi (rujukan historis)",
        sourceUrl, sourceHash, sourceLocator: arsitek ? `Bagian ${role.title} jenjang ${role.level}; silang https://bnsp.go.id/lsp/sertifikasi-arsitek-indonesia-sarsi dan https://lsp-sarsi.id/skema-sertifikasi.html`
          : "Keputusan registrasi 8 November 2022, masa berlaku 3 tahun; dokumen unit standar, bukan pemetaan paket per jenjang.",
        status: "unverified", validFrom: null, validUntil: null,
        unitCodes: numbers ? numbers.map(n => `M.71ARS00.${String(n).padStart(3, "0")}.2`) : [],
        reason: arsitek ? "Paket kandidat ditelusuri dari PDF dan halaman resmi SARSI. BNSP menampilkan jumlah unit 8/8/6/4 tetapi PDF memuat catatan menunggu persetujuan update skema. Nomor revisi, tanggal efektif dan kode unit paket perlu konfirmasi dokumen skema disahkan. Tidak membuka Siap Diajukan."
          : "Registrasi historis sudah melewati 3 tahun pada 8 November 2025. Perpanjangan/pengganti dan pemetaan paket per jenjang belum terbukti. Seluruh unit dokumen tidak dianggap paket wajib.",
        checkedBy: "source-research", checkedAt,
      });
    }
  });
  console.log("UJK append-only protection and unverified source provenance installed.");
} finally { await pool.end(); }
