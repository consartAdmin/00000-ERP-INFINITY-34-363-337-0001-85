export const onlyDigits = (s='') => String(s).replace(/\D+/g,'');
export const fmtCnpjCpf = (v) => {
  const d = onlyDigits(v);
  if (d.length===14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
  if (d.length===11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
  return v || '';
};
export const isoDate = (d=new Date()) => d.toISOString();
