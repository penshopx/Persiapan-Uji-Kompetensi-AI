export const errMsg = (e: unknown, fb = 'Permintaan gagal diproses.') =>
  (e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || fb;
export const statusText: Record<string, string> = {
  belum_siap: 'Belum siap', perlu_perbaikan: 'Perlu perbaikan', siap_diajukan: 'Siap diajukan (internal)',
};
export const confidenceText: Record<string, string> = {
  none: 'Belum paham', learning: 'Sedang belajar', practiced: 'Sudah berlatih', confident: 'Yakin',
};
export const fmtDate = (s: string) => new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
export const uuid = () => crypto.randomUUID();
