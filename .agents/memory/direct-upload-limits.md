---
name: Batas byte upload langsung
description: Pisahkan kuota byte yang dipesan dari pembatasan byte transfer aktual pada URL upload langsung.
---

Jangan menyatakan validasi ukuran metadata atau pemeriksaan sebelum finalisasi sebagai hard cap transfer ke App Storage. Sebelum menambahkan batas ukuran pada signer sidecar, pastikan dukungannya lewat kontrak resmi atau uji kapabilitas yang disetujui; jangan mengirim field/header yang diasumsikan berfungsi.

**Why:** Investigasi integrasi menemukan kontrak PUT yang hanya mendokumentasikan lokasi, metode, dan expiry. Pencarian dokumentasi Replit tidak menemukan dukungan policy ukuran yang bisa diverifikasi. Ini bukan bukti bahwa layanan tidak mungkin mendukungnya, tetapi belum cukup untuk menjanjikan pembatasan byte fisik.

**How to apply:** Saat mengevaluasi budget penyimpanan publik, bedakan ukuran yang dipesan, ukuran objek yang diterima, dan total lalu lintas transfer. Jangan mengubah ACL privat atau credential setup sebagai jalan pintas.
