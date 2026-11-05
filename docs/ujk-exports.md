# Paket persiapan UJK

Di perjalanan peserta, tab **Paket LSP** membuat ZIP persiapan melalui persetujuan eksplisit. Bukti tidak dipilih secara otomatis. Paket bukan sertifikat atau keputusan K/BK dan tidak dikirim ke LSP; penyerahan dilakukan peserta di luar aplikasi.

## Isi dan konsistensi

- `manifest.json`: waktu snapshot, status dan penghalang kesiapan, skema beserta versi/provenance/status berlaku, unit dan rencana belajar, metadata bukti terpilih, riwayat reviewer terkait, laporan simulasi dan jawaban latihan yang ditangkap saat pengajuan simulasi.
- `ringkasan.html`: ringkasan mandiri yang aman dibuka tanpa aplikasi; teks pengguna di-escape.
- `bukti/<UUID>.<ekstensi>`: salinan byte final hanya bukti yang dipilih. Manifest menyimpan checksum SHA-256 setiap berkas.
- Kesiapan dihitung terhadap seluruh paspor, bukan hanya bukti terpilih. Kelengkapan lampiran dilaporkan terpisah: unit wajib tanpa bukti terpilih yang diterima tidak disembunyikan.
- Skema belum terverifikasi atau tidak berlaku tetap dilabeli apa adanya; unit rujukan tidak dipromosikan menjadi unit wajib.
- Pembacaan kesiapan memakai satu transaksi PostgreSQL `repeatable read`, termasuk seluruh input dan satu waktu evaluasi. Perubahan setelah snapshot tidak mengubah ZIP lama. Permintaan yang memakai versi peristiwa/skema UI yang sudah tertinggal ditolak dengan 409, lalu peserta memeriksa dan menyetujui ulang.
- Byte bukti berasal dari objek final yang tidak pernah mendapat signed PUT peserta. Pembacaan dipatok pada generation dan diverifikasi checksum penyimpanan. SHA-256 ZIP ditampilkan di aplikasi.

## Akses dan audit

Objek ZIP berada di direktori privat App Storage dengan ACL pemilik. PostgreSQL hanya menyimpan path dan metadata, bukan byte berkas. Jalur bukti umum tidak mengizinkan akses ZIP karena ZIP tidak terdaftar sebagai unggahan bukti final.

Semua endpoint memerlukan sesi pemilik jalur. Reviewer dan pengelola tidak mendapat akses ZIP dari penugasan review. Tidak ada signed GET yang dapat dibagikan. Unduhan hanya tersedia 24 jam setelah pembuatan; peserta dapat mencabutnya lebih awal. Pemeriksaan unduh dan pencabutan diserialkan dengan row lock sehingga permintaan unduh baru tidak dapat melewati pencabutan yang sudah selesai.

Peristiwa audit append-only: `preparation_export_created`, `preparation_export_download` (akses unduhan diberikan, bukan jaminan perangkat menerima seluruh byte), `preparation_export_revoked`. Audit pembuatan mencatat persetujuan, identitas pelaku, daftar bukti, snapshot, revisi skema, hash dan batas waktu. Pencabutan tidak menghapus riwayat. Salinan yang sudah diunduh tidak dapat ditarik kembali.

Batas awal: maksimal 20 berkas, ZIP maksimal 50 MB. Pembuatan gagal utuh bila satu bukti tidak sah, tidak tersedia, atau berubah ukuran. Tidak ada paket sukses yang diam-diam melewati bukti gagal. Objek yang belum berhasil dipublikasikan dibersihkan saat kegagalan; kegagalan pembersihan dicatat tanpa isi bukti. Kedaluwarsa saat ini membatasi akses aplikasi, **bukan** penghapusan fisik otomatis dari bucket.

## Verifikasi

```sh
pnpm run typecheck
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/tests/ujk-export-package.test.ts
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/tests/ujk-export-snapshot.test.ts
```

Tes snapshot database memakai fixture dalam transaksi yang di-rollback; tidak menerbitkan skema tes ke katalog pengguna.
