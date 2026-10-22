---
name: Batas tanggal kontrak API
description: Perbedaan tanggal hasil parser request dan tanggal pada respons JSON.
---

Jangan memakai nilai tanggal hasil parser request langsung sebagai nilai respons. Generator OpenAPI/Zod dapat mengubah `date-time` menjadi objek `Date`, sementara properti respons tetap berupa string ISO.

**Why:** Keputusan review dapat berhasil tersimpan tetapi respons detail kemudian gagal validasi jika tanggal hasil parse diteruskan tanpa serialisasi. Kegagalan respons setelah commit juga membuat pengguna mengira keputusan belum tersimpan.

**How to apply:** Serialisasikan tanggal secara eksplisit di batas respons dan uji pembacaan detail setelah mutasi tersimpan, bukan hanya typecheck dan penulisan berhasil.
