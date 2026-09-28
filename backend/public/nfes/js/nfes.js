// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.js                                                        ║
// ║ MODULE: NF-es Front                                                  ║
// ║ CONSART ERP                                                          ║
// ║ Entry point principal do módulo                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { bindModalInutilizarOnce } from './nfes.inutilizar.js';
import { bindUI, bootNfes, fetchNfes } from './nfes.init.js';

document.addEventListener('DOMContentLoaded', () => {
  bindModalInutilizarOnce();
  bindUI();
  bootNfes();
});

window.addEventListener('nfes:reload', () => {
  fetchNfes();
});