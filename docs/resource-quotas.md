# Kuota AI dan unggahan

## Batas layanan

Semua server memakai PostgreSQL yang sama. Penghitungan menggunakan waktu database dan jendela tetap UTC, bukan memori proses.

| Sumber daya | Batas |
| --- | --- |
| Giliran AI | 20/jam/akun; tamu memakai hash IP |
| AI seluruh layanan | 200 giliran/hari, 3 proses bersamaan |
| Permintaan URL unggahan | 20/jam dan 50/hari/akun, lintas semua perjalanan |
| Byte yang dipesan untuk unggahan | 100 MiB/hari/akun |
| Staging belum difinalisasi | 5 berkas / 30 MiB/akun |
| Berkas individual | 10 MiB, PDF/PNG/JPEG |

Satu giliran AI dapat memanggil beberapa agen. Batas ini membatasi jumlah giliran, **bukan jaminan anggaran dalam mata uang atau token**. Percobaan upstream gagal tetap memakai kuota karena mungkin sudah menimbulkan biaya. Kegagalan pemeriksaan kuota menutup akses AI/upload (503), tidak memakai fallback process-local. Penolakan kuota mengembalikan 429, pesan Indonesia dan `Retry-After`.

Transaksi mengambil advisory lock global AI atau per akun unggahan sebelum memeriksa dan menambah kuota. Jika batas berikutnya menolak, seluruh penambahan dalam transaksi di-rollback. Lease AI lima menit melampaui deadline runtime keseluruhan 150 detik; pelepasan hanya memakai ID lease sendiri. Worker mati tidak mengembalikan kuota yang mungkin sudah ditagihkan. Cache percobaan paspor yang sudah selesai diperiksa **sebelum** reservasi AI, sehingga retry tidak memakai kuota, menjalankan AI, atau menambah event.

## Siklus staging dan bukti

Reservasi database dibuat sebelum URL PUT diterbitkan. Permintaan penandatanganan/transfer yang gagal tetap dihitung dan menyisakan reservasi untuk cleanup; UI memakai ulang URL yang sama selama masih berlaku untuk retry transfer.

URL berlaku 15 menit. Staging kedaluwarsa 24 jam setelah reservasi. Worker berjalan pada startup dan setiap jam, maksimal 100 reservasi per putaran per replica; backlog dibersihkan pada putaran berikutnya. Staging kedaluwarsa yang belum berhasil dibersihkan masih menggunakan kuota pending, agar kegagalan penyimpanan tidak membebaskan reservasi tanpa batas.

Finalisasi dan cleanup mengambil row lock yang sama. Finalisasi memeriksa metadata aktual, menyalin **generasi** staging yang diperiksa ke lokasi privat deterministik yang tidak pernah mendapat URL tulis peserta, menerapkan ACL privat yang sudah ada, lalu mencatat bukti dan event dalam satu transaksi. Copy yang berhasil sebelum crash/rollback dapat dipakai ulang; lokasinya dapat diturunkan dari reservasi sehingga tidak menjadi orphan tak terlacak.

Cleanup tidak memindai atau menghapus direktori secara umum:
- hanya menghapus path staging yang tercatat, setelah 24 jam (URL tulis sudah kedaluwarsa);
- hanya menghapus calon snapshot bila reservasinya **belum** finalized dan row lock dipegang;
- setelah finalized, hanya staging asli yang boleh dibersihkan, bukan snapshot bukti;
- data legacy finalized tanpa path staging dibiarkan;
- tidak menghapus baris unggahan, percobaan, event, keputusan reviewer, atau riwayat;
- object yang sudah hilang aman diulang; kegagalan storage tidak menandai cleanup selesai.

Counter yang sudah lewat dua hari dan lease kedaluwarsa boleh dibersihkan. Itu bukan riwayat peserta.

## Hasil investigasi batas upload langsung

Integrasi App Storage di proyek memakai endpoint sidecar `signed-object-url` dengan bucket, object, method, dan expiry. Kontrak yang tersedia tidak menyediakan policy `content-length-range` atau header ukuran yang ikut ditandatangani. Pencarian dokumentasi Replit untuk kemampuan tersebut tidak menemukan kontrak yang bisa dipakai. Jangan menambahkan field tak terdokumentasi atau mengganti credential sidecar.

Karena itu, **10 MiB adalah validasi metadata permintaan dan validasi sebelum finalisasi**, bukan hard cap byte pada transfer PUT langsung. Klien yang dimodifikasi masih dapat mengirim objek lebih besar atau menimpa staging selama URL berlaku. Kuota byte menghitung ukuran yang dipesan, bukan seluruh lalu lintas fisik; cleanup menghapus staging salah ukuran setelah kedaluwarsa. Snapshot final tidak dapat ditimpa melalui URL peserta. Rujukan protokol GCS: [signed URLs](https://cloud.google.com/storage/docs/access-control/signed-urls), [POST policy documents](https://cloud.google.com/storage/docs/xml-api/post-object-forms).

Hard cap transfer memerlukan dukungan terdokumentasi dari signer (misalnya policy POST dengan batas byte atau header ukuran yang ditandatangani), lalu pengujian terhadap storage nyata. Itu bukan alasan untuk membuka ACL, mengubah setup credential, mem-proxy file ke filesystem, atau mengklaim perlindungan byte yang belum ada.

## Verifikasi

`pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/tests/resource-quotas.test.ts`

Pengujian memakai schema database sementara, dua koneksi terpisah dan storage tiruan; tidak memanggil AI berbayar, tidak menghapus data peserta, dan tidak mengunggah objek produksi. Pengujian journal yang sudah ada tetap mencakup cache hasil selesai dan event tunggal.
