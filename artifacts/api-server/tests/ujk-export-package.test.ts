import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import type { UjkJourneyDetail } from "@workspace/api-zod";
import { makePackageZip, packageManifest, packageReport, sha256 } from "../src/lib/preparation-package";

const detail = {
  journey: { id: "journey", roleId: "role", title: "<script>bad</script>", status: "ready", schemeVerified: true },
  requiredUnitCodes: ["unit1", "unit2"], units: [{ code: "unit1", title: "Unit satu", lastScore: 80 }],
  evidence: [
    { id: "selected", unitCode: "unit1", title: "visible", reviewStatus: "accepted", downloadUrl: "private-url1" },
    { id: "secret", unitCode: "unit2", title: "DO NOT EXPORT", reviewStatus: "accepted", downloadUrl: "private-url2" },
  ],
  review: { lastEventId: 12, simulationReport: "Laporan peserta", simulationAttempts: [], decisions: [{ reason: "DO NOT EXPORT" }] },
  blockers: [], threshold: 75, simulationPassed: true, scheme: { id: "4", version: "v1", sourceHash: "hash", status: "verified" },
  ruleNote: "internal", schemeNote: "verified",
} as unknown as UjkJourneyDetail;
const now = new Date("2026-11-05T12:00:00Z");
const events = [
  { id: 1, kind: "reviewer_assignment", unitCode: null, createdAt: now, payload: { reviewerId: "reviewer" } },
  { id: 2, kind: "evidence_review", unitCode: "unit1", createdAt: now, payload: { evidenceId: "selected", reason: "visible" } },
  { id: 3, kind: "evidence_review", unitCode: "unit2", createdAt: now, payload: { evidenceId: "secret", reason: "DO NOT EXPORT" } },
  { id: 4, kind: "practice", unitCode: "unit2", createdAt: now, payload: { answer: "DO NOT EXPORT" } },
  { id: 5, kind: "simulation_review", unitCode: null, createdAt: now, payload: { reason: "simulation" } },
];

test("Only explicitly selected evidence and related review history enter manifest", () => {
  const manifest = packageManifest(detail, ["selected"], events, now, "export");
  const text = JSON.stringify(manifest);
  assert.equal(manifest.evidence.length, 1);
  assert.deepEqual(manifest.reviewerHistory.map(e => e.id), [1, 2, 5]);
  assert.ok(!text.includes("DO NOT EXPORT"));
  assert.ok(!text.includes("private-url"));
  assert.equal(manifest.readiness.status, detail.journey.status, "Readiness remains the historical full-passport state");
  assert.deepEqual(manifest.packageCompleteness.missingEvidenceUnitCodes, ["unit2"], "Subset package is not misrepresented as complete");
  assert.equal(manifest.packageCompleteness.allRequiredUnitsHaveSelectedAcceptedEvidence, false);
  assert.equal(manifest.snapshotAt, now.toISOString());
  assert.equal(manifest.scheme?.version, "v1");
  assert.equal(manifest.consent.approved, true);
});

test("Zero selection includes no private evidence, and unverified scheme never claims completeness", () => {
  const manifest = packageManifest({ ...detail, journey: { ...detail.journey, schemeVerified: false }, requiredUnitCodes: [] }, [], events, now, "export");
  assert.deepEqual(manifest.evidence, []);
  assert.ok(!manifest.reviewerHistory.some(e => e.kind === "evidence_review"));
  assert.equal(manifest.packageCompleteness.allRequiredUnitsHaveSelectedAcceptedEvidence, false);
});

test("HTML report escapes participant text and never labels itself a certificate", () => {
  const report = packageReport(packageManifest(detail, ["selected"], events, now, "export"));
  assert.ok(report.includes("&lt;script&gt;"));
  assert.ok(!report.includes("<script>"));
  assert.ok(report.includes("bukan sertifikat dan bukan keputusan K/BK"));
  assert.ok(!report.includes("DO NOT EXPORT"));
});

test("ZIP opens with an independent reader and validates all CRCs and exact bytes", () => {
  const zip = makePackageZip([{ name: "manifest.json", data: Buffer.from('{"ok":true}') }, { name: "bukti/id.pdf", data: Buffer.from("%PDF-test") }]);
  const result = execFileSync("python3", ["-c", "import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.namelist()==['manifest.json','bukti/id.pdf']; assert z.read('bukti/id.pdf')==b'%PDF-test'; print('ok')"], { input: zip });
  assert.equal(result.toString().trim(), "ok");
  assert.equal(sha256(zip).length, 64);
  assert.throws(() => makePackageZip([{ name: "../escape", data: Buffer.alloc(0) }]), /Unsafe/);
});
