// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: customersList.validation.js                                   ║
// ║ MODULE: Customers List — Validation                                 ║
// ║ CONSART ERP                                                         ║
// ║ Export-key collection and validation                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export async function askExportKey(typeLabel) {
  const value = window.prompt(
    `Digite a chave para exportar ${typeLabel}:`,
    ''
  );

  if (value == null) return { status: 'cancelled', key: null };

  const key = String(value).trim();
  if (!key) return { status: 'missing', key: '' };

  return { status: 'valid', key };
}
