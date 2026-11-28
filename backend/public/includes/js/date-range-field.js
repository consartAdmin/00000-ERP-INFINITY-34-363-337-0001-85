//backend\public\includes\js\date-range-field.js

'use strict';

import { Modal } from '/public/includes/js/modal.js';

// ======================================================================
// <date-range-field> — seletor de período (De / Até)
// ----------------------------------------------------------------------
// - Abre um modal no padrão modals.css / modal.js (header, body, footer),
//   com altura ajustada ao conteúdo.
// - Atalhos: Hoje, Ontem, Últimos 7/30 dias, Este mês, Mês passado,
//   Este ano.
// - Dois meses lado a lado (um só em telas estreitas).
// - Intervalo destacado entre De e Até, com prévia ao passar o mouse.
// - De / Até digitáveis em dd/mm/aaaa.
// API pública: value {startDate, endDate} (ISO), open(), close(), clear(),
// eventos 'range-change' e 'change'. Estilos em includes/css/date-range-field.css.
// ======================================================================

const SHORTCUTS = [
    { key: 'today', label: 'Hoje' },
    { key: 'yesterday', label: 'Ontem' },
    { key: 'last7', label: 'Últimos 7 dias' },
    { key: 'last30', label: 'Últimos 30 dias' },
    { key: 'thisMonth', label: 'Este mês' },
    { key: 'lastMonth', label: 'Mês passado' },
    { key: 'thisYear', label: 'Este ano' },
];

const template = document.createElement('template');

template.innerHTML = `
    <div class="date-range-field-root">

        <span class="date-range-field-label"></span>

        <button
            class="date-range-field-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded="false"
        >
            <span class="date-range-field-display"></span>
            <span class="date-range-field-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
                    <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
                </svg>
            </span>
        </button>


    </div>
`;


// Modal no padrão modals.css (.modal > .modal__backdrop + .modal__dialog > .modal__panel)
// aberto/fechado pelo modal.js. Vai para o <body> para nunca ficar preso
// em containers com overflow/transform.
const modalTemplate = document.createElement('template');

modalTemplate.innerHTML = `
    <div class="modal date-range-field-modal" aria-hidden="true">
        <div class="modal__backdrop"></div>

        <div class="modal__dialog">
            <div class="modal__panel date-range-field-panel" role="dialog" aria-modal="true">

                <header class="modal__header modal-header-color-3">
                    <h3 class="modal__title"></h3>
                    <button type="button" class="modal__close" aria-label="Fechar" title="Fechar">&times;</button>
                </header>

                <div class="modal__body date-range-field-body">

                    <nav class="date-range-field-shortcuts" aria-label="Atalhos de período">
                        ${SHORTCUTS.map((s) => `
                            <button type="button" class="date-range-field-shortcut" data-shortcut="${s.key}">${s.label}</button>
                        `).join('')}
                    </nav>

                    <div class="modal-section date-range-field-main">

                        <div class="modal-form-grid modal-form-grid--2">
                            <div class="fields fields-w-full fields-h-5 fields-font-3">
                                <label>De</label>
                                <input class="date-range-field-input-start" type="text" inputmode="numeric"
                                    placeholder="dd/mm/aaaa" maxlength="10" autocomplete="off">
                            </div>
                            <div class="fields fields-w-full fields-h-5 fields-font-3">
                                <label>Até</label>
                                <input class="date-range-field-input-end" type="text" inputmode="numeric"
                                    placeholder="dd/mm/aaaa" maxlength="10" autocomplete="off">
                            </div>
                        </div>

                        <div class="date-range-field-months">
                            <button type="button" class="date-range-field-nav date-range-field-prev" aria-label="Mês anterior">‹</button>
                            <button type="button" class="date-range-field-nav date-range-field-next" aria-label="Próximo mês">›</button>
                            <div class="date-range-field-month-block" data-offset="0">
                                <strong class="date-range-field-month"></strong>
                                <div class="date-range-field-weekdays">
                                    <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span><span>Dom</span>
                                </div>
                                <div class="date-range-field-days"></div>
                            </div>
                            <div class="date-range-field-month-block date-range-field-month-block--second" data-offset="1">
                                <strong class="date-range-field-month"></strong>
                                <div class="date-range-field-weekdays">
                                    <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span><span>Dom</span>
                                </div>
                                <div class="date-range-field-days"></div>
                            </div>
                        </div>

                    </div>
                </div>

                <footer class="modal__footer">
                    <span class="date-range-field-summary"></span>
                    <p class="date-range-field-error" role="alert"></p>
                    <button type="button" class="btn btn-cancel btn-sm date-range-field-clear">Limpar</button>
                    <button type="button" class="btn btn-save btn-sm date-range-field-apply">Aplicar</button>
                </footer>

            </div>
        </div>
    </div>
`;


// ======================================================================
// COMPONENT
// ======================================================================

export class DateRangeField extends HTMLElement {

    static formAssociated = true;

    static componentCounter = 0;

    static get observedAttributes() {
        return ['label', 'locale', 'start-date', 'end-date', 'min', 'max', 'disabled', 'required'];
    }

    constructor() {
        super();

        this.append(template.content.cloneNode(true));
        this._modal = modalTemplate.content.firstElementChild.cloneNode(true);

        this._internals = typeof this.attachInternals === 'function' ? this.attachInternals() : null;

        this._committed = { startDate: '', endDate: '' };
        this._draft = { startDate: '', endDate: '' };
        this._hoverDate = '';
        this._viewDate = new Date();
        this._eventsBound = false;

        DateRangeField.componentCounter += 1;
        this._componentId = `date-range-field-${DateRangeField.componentCounter}`;
    }


    // ==================================================================
    // LIFECYCLE
    // ==================================================================

    connectedCallback() {
        if (!this._modal.isConnected) document.body.append(this._modal);
        this._cacheElements();
        this._configureAccessibility();
        this._syncFromAttributes();
        this._bindEvents();
        this._render();
    }

    disconnectedCallback() {
        if (Modal.isOpen(this._modal)) Modal.close(this._modal);
        this._modal.remove();
    }

    attributeChangedCallback() {
        if (!this.isConnected || !this._trigger) return;
        this._syncFromAttributes();
        this._render();
    }

    formResetCallback() {
        this.value = {
            startDate: this.getAttribute('start-date') || '',
            endDate: this.getAttribute('end-date') || '',
        };
    }


    // ==================================================================
    // CACHE / ACCESSIBILITY
    // ==================================================================

    _cacheElements() {
        const own = (selector) => this.querySelector(selector);
        const $ = (selector) => this._modal.querySelector(selector);

        this._label = own('.date-range-field-label');
        this._trigger = own('.date-range-field-trigger');
        this._display = own('.date-range-field-display');
        this._panel = $('.date-range-field-panel');
        this._title = $('.modal__title');
        this._closeBtn = $('.modal__close');
        this._backdrop = $('.modal__backdrop');
        this._monthBlocks = [...this._modal.querySelectorAll('.date-range-field-month-block')];
        this._monthsWrap = $('.date-range-field-months');
        this._prev = $('.date-range-field-prev');
        this._next = $('.date-range-field-next');
        this._shortcuts = $('.date-range-field-shortcuts');
        this._inputStart = $('.date-range-field-input-start');
        this._inputEnd = $('.date-range-field-input-end');
        this._summary = $('.date-range-field-summary');
        this._error = $('.date-range-field-error');
        this._clear = $('.date-range-field-clear');
        this._apply = $('.date-range-field-apply');
    }

    _configureAccessibility() {
        const labelId = `${this._componentId}-label`;
        const panelId = `${this._componentId}-panel`;
        const titleId = `${this._componentId}-title`;

        this._label.id = labelId;
        this._title.id = titleId;
        this._panel.id = panelId;
        this._panel.setAttribute('aria-labelledby', titleId);

        this._trigger.setAttribute('aria-labelledby', labelId);
        this._trigger.setAttribute('aria-controls', panelId);
    }


    // ==================================================================
    // ATTRIBUTES / VALUE
    // ==================================================================

    _syncFromAttributes() {
        this._label.textContent = this.getAttribute('label') || 'Intervalo';
        this._title.textContent = this.getAttribute('label') || 'Período';

        const startDate = this.getAttribute('start-date') || '';
        const endDate = this.getAttribute('end-date') || '';

        if (startDate || endDate) {
            this._committed = { startDate, endDate };
            this._draft = { startDate, endDate };
        }

        this._trigger.disabled = this.hasAttribute('disabled');
    }

    get value() {
        return { ...this._committed };
    }

    set value(range = {}) {
        this._committed = {
            startDate: range.startDate || '',
            endDate: range.endDate || '',
        };
        this._draft = { ...this._committed };
        if (this._trigger) this._render();
    }

    /** Limpa o período sem disparar eventos (quem chama recarrega a lista). */
    clear() {
        this.value = { startDate: '', endDate: '' };
        if (this._error) this._error.textContent = '';
    }


    // ==================================================================
    // EVENTS
    // ==================================================================

    _bindEvents() {
        if (this._eventsBound) return;
        this._eventsBound = true;

        this._trigger.addEventListener('click', () => (Modal.isOpen(this._modal) ? this.close() : this.open()));

        this._prev.addEventListener('click', () => this._shiftMonth(-1));
        this._next.addEventListener('click', () => this._shiftMonth(1));

        this._monthsWrap.addEventListener('click', (event) => {
            const button = event.target.closest('.date-range-field-day');
            if (button?.dataset.date && !button.disabled) this._selectDate(button.dataset.date);
        });

        // Prévia do intervalo enquanto escolhe a data final
        this._monthsWrap.addEventListener('mouseover', (event) => {
            if (!this._draft.startDate || this._draft.endDate) return;
            const button = event.target.closest('.date-range-field-day');
            const date = button?.dataset.date || '';
            if (date !== this._hoverDate) {
                this._hoverDate = date;
                this._renderCalendar();
            }
        });

        this._monthsWrap.addEventListener('mouseleave', () => {
            if (!this._hoverDate) return;
            this._hoverDate = '';
            this._renderCalendar();
        });

        this._shortcuts.addEventListener('click', (event) => {
            const button = event.target.closest('[data-shortcut]');
            if (button) this._applyShortcut(button.dataset.shortcut);
        });

        for (const [input, key] of [[this._inputStart, 'startDate'], [this._inputEnd, 'endDate']]) {
            input.addEventListener('input', () => this._onTypedDate(input, key));
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this._applyDraft();
                }
            });
            input.addEventListener('blur', () => this._renderInputs());
        }

        this._clear.addEventListener('click', () => {
            this._draft = { startDate: '', endDate: '' };
            this._hoverDate = '';
            this._error.textContent = '';
            this._renderPanel();
        });

        this._apply.addEventListener('click', () => this._applyDraft());

        // X e clique fora do painel fecham sem aplicar
        this._closeBtn.addEventListener('click', () => this.close());
        this._backdrop.addEventListener('click', () => this.close());
        this._modal.querySelector('.modal__dialog').addEventListener('click', (event) => {
            if (event.target === event.currentTarget) this.close();
        });

        // Esc fecha só este modal (não deixa chegar aos handlers da página)
        this._modal.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            this.close();
        });

        this._modal.addEventListener('modal:close', () => {
            this._trigger.setAttribute('aria-expanded', 'false');
        });
    }


    // ==================================================================
    // OPEN / CLOSE
    // ==================================================================

    open() {
        if (this.hasAttribute('disabled')) return;

        this._draft = { ...this._committed };
        this._hoverDate = '';
        this._error.textContent = '';

        const base = this._draft.startDate ? this._dateFromIso(this._draft.startDate) : new Date();
        // Com dois meses visíveis, o mês atual fica à direita
        const showTwo = this._visibleMonths() > 1 && !this._draft.startDate;
        this._viewDate = new Date(base.getFullYear(), base.getMonth() - (showTwo ? 1 : 0), 1);

        this._renderPanel();

        Modal.open(this._modal, { focusSelector: '.date-range-field-apply' });

        this._trigger.setAttribute('aria-expanded', 'true');
    }

    close() {
        if (this._modal && Modal.isOpen(this._modal)) Modal.close(this._modal);
        this._trigger?.setAttribute('aria-expanded', 'false');
    }

    _visibleMonths() {
        return window.matchMedia('(max-width: 760px)').matches ? 1 : 2;
    }


    // ==================================================================
    // SELECTION
    // ==================================================================

    _shiftMonth(step) {
        this._viewDate = new Date(this._viewDate.getFullYear(), this._viewDate.getMonth() + step, 1);
        this._renderCalendar();
    }

    _selectDate(isoDate) {
        const { startDate, endDate } = this._draft;

        if (!startDate || endDate) {
            // Começa um novo intervalo
            this._draft = { startDate: isoDate, endDate: '' };
        } else if (isoDate < startDate) {
            this._draft = { startDate: isoDate, endDate: startDate };
        } else {
            this._draft = { startDate, endDate: isoDate };
        }

        this._hoverDate = '';
        this._error.textContent = '';
        this._renderPanel();
    }

    _applyShortcut(key) {
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth();
        const d = today.getDate();
        let start;
        let end = today;

        switch (key) {
            case 'today': start = today; break;
            case 'yesterday': start = new Date(y, m, d - 1); end = start; break;
            case 'last7': start = new Date(y, m, d - 6); break;
            case 'last30': start = new Date(y, m, d - 29); break;
            case 'thisMonth': start = new Date(y, m, 1); end = new Date(y, m + 1, 0); break;
            case 'lastMonth': start = new Date(y, m - 1, 1); end = new Date(y, m, 0); break;
            case 'thisYear': start = new Date(y, 0, 1); end = new Date(y, 11, 31); break;
            default: return;
        }

        this._draft = {
            startDate: this._clampIso(this._toIsoDate(start)),
            endDate: this._clampIso(this._toIsoDate(end)),
        };
        this._hoverDate = '';
        this._error.textContent = '';

        // Mostra o mês final do atalho
        const months = this._visibleMonths();
        this._viewDate = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
        if (months > 1 && start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
            this._viewDate = new Date(end.getFullYear(), end.getMonth() - 1, 1);
        }

        this._renderPanel();
    }

    _onTypedDate(input, key) {
        // Máscara dd/mm/aaaa
        const digits = input.value.replace(/\D/g, '').slice(0, 8);
        let masked = digits;
        if (digits.length > 4) masked = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
        else if (digits.length > 2) masked = `${digits.slice(0, 2)}/${digits.slice(2)}`;
        if (masked !== input.value) input.value = masked;

        if (digits.length === 0) {
            this._draft[key] = '';
            this._error.textContent = '';
            this._renderCalendar();
            this._renderSummary();
            return;
        }

        if (digits.length < 8) return;

        const iso = this._parseBr(masked);
        if (!iso) {
            this._error.textContent = 'Data inválida. Use dd/mm/aaaa.';
            return;
        }

        this._draft[key] = iso;
        this._error.textContent = '';
        const months = this._visibleMonths();
        const date = this._dateFromIso(iso);
        this._viewDate = new Date(date.getFullYear(), date.getMonth() - (key === 'endDate' ? months - 1 : 0), 1);
        this._renderCalendar();
        this._renderSummary();
    }


    // ==================================================================
    // APPLY
    // ==================================================================

    _applyDraft() {
        const { startDate, endDate } = this._draft;

        if (this.hasAttribute('required') && (!startDate || !endDate)) {
            this._error.textContent = 'Selecione as duas datas.';
            return;
        }

        if (startDate && endDate && endDate < startDate) {
            this._error.textContent = 'A data final deve ser igual ou posterior à inicial.';
            return;
        }

        this._committed = { startDate, endDate };
        this._draft = { ...this._committed };

        this._render();
        this._emitChange();
        this.close();
    }


    // ==================================================================
    // RENDER
    // ==================================================================

    _render() {
        this._renderDisplay();
        this._renderPanel();
        this._updateFormValue();
    }

    _renderPanel() {
        this._renderCalendar();
        this._renderInputs();
        this._renderSummary();
    }

    _renderDisplay() {
        const { startDate, endDate } = this._committed;

        if (!startDate && !endDate) {
            this._display.textContent = 'Selecione um período';
            this._display.classList.add('placeholder');
            return;
        }

        this._display.classList.remove('placeholder');

        const start = startDate ? this._formatDate(startDate) : '…';
        const end = endDate ? this._formatDate(endDate) : '…';

        this._display.textContent = startDate === endDate ? start : `${start} – ${end}`;
    }

    _renderInputs() {
        if (document.activeElement !== this._inputStart) {
            this._inputStart.value = this._draft.startDate ? this._formatDate(this._draft.startDate) : '';
        }
        if (document.activeElement !== this._inputEnd) {
            this._inputEnd.value = this._draft.endDate ? this._formatDate(this._draft.endDate) : '';
        }
    }

    _renderSummary() {
        const { startDate, endDate } = this._draft;
        let text = '';

        if (startDate && endDate) {
            const days = Math.round((this._dateFromIso(endDate) - this._dateFromIso(startDate)) / 86400000) + 1;
            text = days === 1 ? '1 dia selecionado' : `${days} dias selecionados`;
        } else if (startDate) {
            text = `A partir de ${this._formatDate(startDate)}`;
        } else if (endDate) {
            text = `Até ${this._formatDate(endDate)}`;
        } else {
            text = 'Escolha a data inicial';
        }

        this._summary.textContent = text;

        // Destaca o atalho que corresponde ao período atual
        for (const button of this._shortcuts.querySelectorAll('[data-shortcut]')) {
            button.classList.toggle('is-active', this._shortcutMatches(button.dataset.shortcut));
        }
    }

    _shortcutMatches(key) {
        const { startDate, endDate } = this._draft;
        if (!startDate || !endDate) return false;
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth();
        const d = today.getDate();
        const iso = (date) => this._toIsoDate(date);
        const map = {
            today: [iso(today), iso(today)],
            yesterday: [iso(new Date(y, m, d - 1)), iso(new Date(y, m, d - 1))],
            last7: [iso(new Date(y, m, d - 6)), iso(today)],
            last30: [iso(new Date(y, m, d - 29)), iso(today)],
            thisMonth: [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))],
            lastMonth: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
            thisYear: [iso(new Date(y, 0, 1)), iso(new Date(y, 11, 31))],
        };
        const range = map[key];
        return Boolean(range) && range[0] === startDate && range[1] === endDate;
    }

    _renderCalendar() {
        if (!this._monthBlocks?.length) return;

        const locale = this.getAttribute('locale') || 'pt-BR';
        const monthFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
        const todayIso = this._toIsoDate(new Date());

        // Fim efetivo do intervalo (inclui a prévia do mouse)
        const start = this._draft.startDate;
        let end = this._draft.endDate;
        let rangeStart = start;
        let preview = false;
        if (start && !end && this._hoverDate) {
            preview = true;
            if (this._hoverDate < start) {
                rangeStart = this._hoverDate;
                end = start;
            } else {
                end = this._hoverDate;
            }
        }

        for (const block of this._monthBlocks) {
            const offset = Number(block.dataset.offset || 0);
            const first = new Date(this._viewDate.getFullYear(), this._viewDate.getMonth() + offset, 1);
            const year = first.getFullYear();
            const month = first.getMonth();

            // "novembro de 2026" -> "Novembro de 2026"
            const title = monthFormat.format(first);
            block.querySelector('.date-range-field-month').textContent =
                title.charAt(0).toLocaleUpperCase(locale) + title.slice(1);

            const startWeekDay = (first.getDay() + 6) % 7; // segunda = 0
            const totalDays = new Date(year, month + 1, 0).getDate();

            let html = '';
            for (let i = 0; i < startWeekDay; i += 1) {
                html += '<span class="date-range-field-day-empty"></span>';
            }

            for (let day = 1; day <= totalDays; day += 1) {
                const isoDate = this._toIsoDate(new Date(year, month, day));
                const classes = ['date-range-field-day'];

                if (isoDate === rangeStart) classes.push('is-start');
                if (end && isoDate === end) classes.push('is-end');
                if (rangeStart && end && isoDate > rangeStart && isoDate < end) classes.push('is-in-range');
                if (preview) classes.push('is-preview');
                if (isoDate === todayIso) classes.push('is-today');

                const disabled = this._isDateDisabled(isoDate);
                if (disabled) classes.push('is-disabled');

                html += `<button type="button" class="${classes.join(' ')}" data-date="${isoDate}"${disabled ? ' disabled' : ''}>${day}</button>`;
            }

            block.querySelector('.date-range-field-days').innerHTML = html;
        }
    }


    // ==================================================================
    // HELPERS
    // ==================================================================

    _isDateDisabled(isoDate) {
        const min = this.getAttribute('min');
        const max = this.getAttribute('max');
        return Boolean((min && isoDate < min) || (max && isoDate > max));
    }

    _clampIso(isoDate) {
        const min = this.getAttribute('min');
        const max = this.getAttribute('max');
        if (min && isoDate < min) return min;
        if (max && isoDate > max) return max;
        return isoDate;
    }

    _formatDate(isoDate) {
        if (!isoDate) return '';
        const [year, month, day] = isoDate.split('-');
        return `${day}/${month}/${year}`;
    }

    _parseBr(text) {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text || '');
        if (!match) return '';
        const [, dd, mm, yyyy] = match;
        const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
        if (date.getFullYear() !== Number(yyyy) || date.getMonth() !== Number(mm) - 1 || date.getDate() !== Number(dd)) {
            return '';
        }
        const iso = `${yyyy}-${mm}-${dd}`;
        return this._isDateDisabled(iso) ? '' : iso;
    }

    _dateFromIso(isoDate) {
        const [year, month, day] = isoDate.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    _toIsoDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }


    // ==================================================================
    // FORM VALUE / CHANGE EVENTS
    // ==================================================================

    _updateFormValue() {
        const formData = new FormData();
        formData.append(this.getAttribute('name-start') || 'dateFrom', this._committed.startDate);
        formData.append(this.getAttribute('name-end') || 'dateTo', this._committed.endDate);
        this._internals?.setFormValue(formData);
    }

    _emitChange() {
        this.dispatchEvent(new CustomEvent('range-change', {
            bubbles: true,
            composed: true,
            detail: this.value,
        }));

        this.dispatchEvent(new Event('change', { bubbles: true }));
    }
}


// ======================================================================
// REGISTER
// ======================================================================

if (!customElements.get('date-range-field')) {
    customElements.define('date-range-field', DateRangeField);
}
