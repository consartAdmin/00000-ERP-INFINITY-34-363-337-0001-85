//backend\public\includes\js\brDateTimeInput.js

'use strict';

// ======================================================================
// CAMPO DATA/HORA NO FORMATO BRASILEIRO (dd/mm/aaaa hh:mm ou dd/mm/aaaa)
// ----------------------------------------------------------------------
// O <input type="datetime-local"> mostra a data no formato do idioma do
// navegador (mm/dd/aaaa em inglês). Este módulo mostra um campo de texto
// com máscara dd/mm/aaaa hh:mm e mantém o input original escondido, com o
// mesmo id e o mesmo .value (aaaa-mm-ddThh:mm). Assim o restante do código
// continua lendo e gravando o input original sem nenhuma mudança.
// O botão de calendário abre o seletor nativo do input original.
// Funciona com type="datetime-local" (dd/mm/aaaa hh:mm) e type="date"
// (dd/mm/aaaa, .value aaaa-mm-dd).
// ======================================================================

const STYLE_ID = 'br-datetime-input-style';

const CSS = `
.br-dt-wrap { position: relative; display: block; width: 100%; }
.br-dt-wrap .br-dt-text { width: 100%; padding-right: 30px; box-sizing: border-box; }
.br-dt-wrap .br-dt-native {
    position: absolute; right: 0; bottom: 0; width: 28px; height: 100%;
    opacity: 0; pointer-events: none; border: 0; padding: 0;
}
.br-dt-wrap .br-dt-btn {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    width: 22px; height: 22px; padding: 0; border: 0; background: transparent;
    cursor: pointer; color: #555; display: flex; align-items: center; justify-content: center;
}
.br-dt-wrap .br-dt-btn:hover { color: #1a56db; }
.br-dt-wrap .br-dt-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; }
`;

const ICON = `
<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
</svg>`;

const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

const pad = (n) => String(n).padStart(2, '0');

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

// "2026-10-28T18:58" -> "28/10/2026 18:58" ("2026-10-28" -> "28/10/2026" sem hora)
export function isoToBr(iso, withTime = true) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(iso || ''));
    if (!m) return '';
    const date = `${m[3]}/${m[2]}/${m[1]}`;
    return withTime ? `${date} ${m[4] ?? '00'}:${m[5] ?? '00'}` : date;
}

// "28/10/2026 18:58" -> "2026-10-28T18:58" ("28/10/2026" -> "2026-10-28" sem hora)
// Retorna '' se a data estiver incompleta ou inválida.
export function brToIso(br, withTime = true) {
    const re = withTime
        ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/
        : /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const m = re.exec(String(br || '').trim());
    if (!m) return '';

    const [, dd, mm, yyyy, hh = 0, mi = 0] = m.map(Number);
    const d = new Date(yyyy, mm - 1, dd, hh, mi);

    const ok =
        yyyy >= 1900 &&
        d.getFullYear() === yyyy &&
        d.getMonth() === mm - 1 &&
        d.getDate() === dd &&
        hh < 24 && mi < 60;

    if (!ok) return '';

    const date = `${yyyy}-${pad(mm)}-${pad(dd)}`;
    return withTime ? `${date}T${pad(hh)}:${pad(mi)}` : date;
}

// Aplica a máscara dd/mm/aaaa hh:mm aos dígitos digitados
function mask(text, withTime = true) {
    const digits = String(text || '').replace(/\D/g, '').slice(0, withTime ? 12 : 8);
    let out = '';
    for (let i = 0; i < digits.length; i++) {
        if (i === 2 || i === 4) out += '/';
        if (i === 8) out += ' ';
        if (i === 10) out += ':';
        out += digits[i];
    }
    return out;
}

export function enhanceBrDateTime(native) {
    if (!native || native.dataset.brDateTime === '1') return;
    native.dataset.brDateTime = '1';

    injectStyle();

    const withTime = native.type !== 'date';

    const text = document.createElement('input');
    text.type = 'text';
    text.id = `${native.id}_br`;
    text.className = 'br-dt-text';
    text.placeholder = withTime ? 'dd/mm/aaaa hh:mm' : 'dd/mm/aaaa';
    text.inputMode = 'numeric';
    text.autocomplete = 'off';
    text.maxLength = withTime ? 16 : 10;

    if (native.required) {
        text.required = true;
        native.required = false;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'br-dt-btn';
    btn.title = 'Abrir calendário';
    btn.innerHTML = ICON;

    const wrap = document.createElement('span');
    wrap.className = 'br-dt-wrap';
    native.parentNode.insertBefore(wrap, native);
    wrap.append(text, native, btn);

    native.classList.add('br-dt-native');
    native.tabIndex = -1;
    native.setAttribute('aria-hidden', 'true');

    const label = native.id && document.querySelector(`label[for="${native.id}"]`);
    if (label) label.htmlFor = text.id;

    const syncFromNative = () => {
        text.value = isoToBr(nativeValue.get.call(native), withTime);
    };

    // Quem grava .value no input original (ex.: data padrão, edição)
    // também atualiza o campo visível.
    Object.defineProperty(native, 'value', {
        configurable: true,
        get() {
            return nativeValue.get.call(native);
        },
        set(v) {
            nativeValue.set.call(native, v);
            syncFromNative();
        },
    });

    native.focus = (...args) => text.focus(...args);

    text.addEventListener('input', () => {
        const masked = mask(text.value, withTime);
        if (masked !== text.value) text.value = masked;
        nativeValue.set.call(native, brToIso(masked, withTime));
    });

    text.addEventListener('blur', () => {
        if (text.value && !brToIso(text.value, withTime)) {
            text.setCustomValidity(`Data inválida. Use ${text.placeholder}.`);
        } else {
            text.setCustomValidity('');
        }
    });

    text.addEventListener('input', () => text.setCustomValidity(''));

    // Seletor nativo (calendário)
    native.addEventListener('change', syncFromNative);
    native.addEventListener('input', syncFromNative);

    btn.addEventListener('click', () => {
        try {
            native.showPicker();
        } catch {
            text.focus();
        }
    });

    native.form?.addEventListener('reset', () => setTimeout(syncFromNative, 0));

    syncFromNative();
}
