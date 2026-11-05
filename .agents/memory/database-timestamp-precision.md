---
name: Presisi timestamp database
description: Penguncian retry harus tetap benar meski PostgreSQL dan JavaScript memakai presisi waktu berbeda.
---

Jangan memakai kesamaan timestamp hasil baca melalui JavaScript Date sebagai satu-satunya compare-and-swap untuk retry. Gunakan versi/status atau syarat kedaluwarsa yang diperbarui secara atomik.

**Why:** PostgreSQL dapat menyimpan mikrodetik sementara Date hanya mempertahankan milidetik. Timestamp yang dibaca lalu ditulis ulang melalui JavaScript tidak selalu sama dengan nilai database, sehingga penguncian berbasis kesamaan bisa menolak retry yang sah.

**How to apply:** Pada penguncian yang memakai waktu, uji dengan timestamp default database, bukan hanya tanggal buatan JavaScript. Pastikan pengambil pertama memperbarui status atau waktu sehingga pengambil kedua tidak lolos.
