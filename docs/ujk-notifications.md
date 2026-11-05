# Pemberitahuan persiapan

- Kotak masuk `/notifikasi` hanya memuat pesan untuk akun yang masuk. Status dibaca disimpan terpisah dari event audit dan catatan pengiriman yang append-only.
- Penetapan reviewer menghasilkan permintaan consent kepada peserta dan pemberitahuan generik kepada reviewer. Pemberian/pencabutan consent mengirim kabar kepada reviewer. Penolakan bukti atau simulasi mengirim pesan kepada peserta.
- Masa berlaku yang dipantau adalah **keputusan tinjauan bukti dan persetujuan simulasi**, bukan tenggat buatan untuk consent akses. Consent akses tetap mengikuti penugasan persis dan pencabutan oleh peserta.
- Keputusan diterima yang masih sesuai dengan penugasan, consent dan skema terbaru menghasilkan pengingat mulai tujuh hari sebelum kedaluwarsa, lalu pesan kedaluwarsa. Simulasi juga harus sesuai snapshot pekerjaan terbaru. Pengingat tidak mengubah keputusan, consent, hasil K3, atau kesiapan.
- Pemeriksaan berjalan pada startup, setiap jam, dan saat kotak masuk dimuat. Setelah server tidak aktif, pemeriksaan berikutnya mengejar pesan yang belum tercatat. Kunci unik per akun/sumber/jenis mencegah duplikasi antar-replika dan retry. Tidak ada jaminan pengiriman saat semua server berhenti.
- Halaman memuat 30 pesan per halaman dan memperbarui data setiap 30 detik serta saat fokus kembali. Pesan lama tetap tersimpan.
- Isi pesan tidak memuat nama peserta/reviewer, identitas kasus, alasan keputusan, nama berkas, maupun isi bukti. Bila izin belum/tidak lagi aktif, server menyamarkan jenis dan tenggat serta tidak mengirim ID/tautan kasus. Resolver memeriksa ulang izin saat diklik; endpoint kasus dan unduhan tetap menegakkan izin sendiri.
- Terapkan tabel tambahan dengan perintah push skema dev dan jalankan `artifacts/api-server/scripts/setup-ujk-review.ts` untuk memasang perlindungan append-only. Skrip post-merge yang sudah ada menjalankan keduanya.

Pemeriksaan regresi:

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/tests/ujk-notifications.test.ts
```

Pengujian database memakai transaksi yang dibatalkan; tidak mengubah riwayat peserta.
