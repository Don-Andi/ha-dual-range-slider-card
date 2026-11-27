/**
 * Dual Range Slider Card
 * Zero-dependency Lovelace card for Home Assistant.
 * Two handles on one scale, bound to input_number or number entities.
 *
 * https://github.com/<your-github-username>/ha-dual-range-slider-card
 * MIT License © 2026 DonAndi
 */
const CARD_TAG = "dual-range-slider-card";
const CARD_VERSION = "1.0.0";

class DualRangeSliderCard extends HTMLElement {
  static getStubConfig() {
    return {
      title: "Range",
      min_entity: "input_number.range_min",
      max_entity: "input_number.range_max",
      current_entity: "sensor.range_current",
    };
  }

  setConfig(config) {
    if (!config || !config.min_entity || !config.max_entity) {
      throw new Error("min_entity and max_entity are required");
    }
    this._config = { ...config };
    this._minVal = null;
    this._maxVal = null;
    this._dragging = null;
    this._rendered = false;
    this._wasCompact = undefined;
    if (this._root || this.isConnected) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._root) this._ensureRoot();
    if (!this._rendered) this._render();
    if (!this._dragging) this._syncFromHass();
    else this._updateLabels();
  }

  getCardSize() {
    if (this._useCompact()) return 1;
    const title = this._title();
    return title ? 3 : 2;
  }

  connectedCallback() {
    if (!this._config) return;
    if (!this._rendered) this._render();
    else if (this._useCompact() !== this._wasCompact) this._render();
  }

  _ensureRoot() {
    if (this._root) return;
    this._root = this.attachShadow({ mode: "open" });
  }

  _title() {
    const cfg = this._config || {};
    const raw = cfg.title !== undefined ? cfg.title : cfg.name;
    return raw == null ? "" : String(raw);
  }

  _useCompact() {
    const cfg = this._config || {};
    if (cfg.compact === true) return true;
    if (cfg.compact === false) return false;
    const mode = cfg.card_mode;
    if (mode === "row" || mode === "compact") return true;
    if (mode === "card") return false;
    try {
      return !!(this.closest && this.closest("ha-card, hui-entities-card"));
    } catch (e) {
      return false;
    }
  }

  _hasNumber(v) {
    return v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));
  }

  _entityState(entityId) {
    return this._hass && this._hass.states ? this._hass.states[entityId] : undefined;
  }

  _entityAttr(entityId, attr) {
    const st = this._entityState(entityId);
    return st && st.attributes ? st.attributes[attr] : undefined;
  }

  _scaleMin() {
    if (this._hasNumber(this._config && this._config.min)) {
      return Number(this._config.min);
    }
    const fromEnt = Number(this._entityAttr(this._config.min_entity, "min"));
    return Number.isFinite(fromEnt) ? fromEnt : 0;
  }

  _scaleMax() {
    if (this._hasNumber(this._config && this._config.max)) {
      return Number(this._config.max);
    }
    const fromEnt = Number(this._entityAttr(this._config.min_entity, "max"));
    if (Number.isFinite(fromEnt)) return fromEnt;
    const fromMax = Number(this._entityAttr(this._config.max_entity, "max"));
    return Number.isFinite(fromMax) ? fromMax : 100;
  }

  _step() {
    if (this._hasNumber(this._config && this._config.step)) {
      const s = Number(this._config.step);
      return s > 0 ? s : 1;
    }
    const fromEnt = Number(this._entityAttr(this._config.min_entity, "step"));
    return fromEnt > 0 ? fromEnt : 1;
  }

  _gap() {
    const step = this._step();
    const span = Math.max(0, this._scaleMax() - this._scaleMin());
    let gap = step;
    if (this._hasNumber(this._config && this._config.min_gap)) {
      const g = Number(this._config.min_gap);
      if (g >= 0) gap = g;
    }
    return Math.min(gap, span);
  }

  _unit() {
    const cfg = this._config || {};
    if (cfg.unit !== undefined && cfg.unit !== null) return String(cfg.unit);
    const fromEnt = this._entityAttr(cfg.min_entity, "unit_of_measurement");
    return fromEnt == null ? "" : String(fromEnt);
  }

  _minLabel() {
    const v = this._config && this._config.min_label;
    return v == null || v === "" ? "Min" : String(v);
  }

  _maxLabel() {
    const v = this._config && this._config.max_label;
    return v == null || v === "" ? "Max" : String(v);
  }

  _currentLabel() {
    const v = this._config && this._config.current_label;
    return v == null || v === "" ? "Current" : String(v);
  }

  _currentEntityId() {
    return this._config && this._config.current_entity
      ? this._config.current_entity
      : "";
  }

  _clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  _decimals() {
    const s = this._step();
    if (!Number.isFinite(s) || s >= 1) return 0;
    const str = String(s);
    if (str.includes("e") || str.includes("E")) {
      const m = /e-(\d+)/i.exec(str);
      return m ? Number(m[1]) : 1;
    }
    const i = str.indexOf(".");
    return i === -1 ? 1 : str.length - i - 1;
  }

  _roundToStep(n) {
    const s = this._step();
    const rounded = Math.round(n / s) * s;
    return Number(rounded.toFixed(this._decimals()));
  }

  _entityNum(entityId, fallback) {
    const st = this._entityState(entityId);
    if (!st) return fallback;
    const v = parseFloat(st.state);
    return Number.isFinite(v) ? v : fallback;
  }

  _currentValue() {
    const id = this._currentEntityId();
    if (!id) return NaN;
    return this._entityNum(id, NaN);
  }

  _syncFromHass() {
    if (!this._hass || !this._config) return;
    const minV = this._entityNum(this._config.min_entity, this._scaleMin());
    const maxV = this._entityNum(this._config.max_entity, this._scaleMax());
    this._minVal = minV;
    this._maxVal = maxV;
    this._applyVisual();
    this._updateLabels();
  }

  _render() {
    this._ensureRoot();
    this._endDragListeners();
    this._dragging = null;
    const compact = this._useCompact();
    this._wasCompact = compact;
    const title = this._title();
    const showHeader = !compact || !!title;
    const wrapStart = compact ? `<div class="content compact">` : `<ha-card><div class="content">`;
    const wrapEnd = compact ? `</div>` : `</div></ha-card>`;

    this._root.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          background: var(--ha-card-background, var(--card-background-color, var(--primary-background-color)));
          color: var(--primary-text-color);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color));
        }
        .content { padding: 12px 16px 16px; }
        .content.compact { padding: 4px 0 2px; }
        .header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 4px;
        }
        .header.no-title { justify-content: flex-end; }
        .title {
          font-size: 16px;
          font-weight: 500;
          line-height: 1.3;
        }
        .content.compact .title { font-size: 14px; }
        .values {
          font-size: 16px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          color: var(--primary-color);
          white-space: nowrap;
        }
        .content.compact .values { font-size: 14px; }
        .meta {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 10px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .content.compact .meta { margin-bottom: 6px; }
        .meta span { min-width: 0; }
        .current {
          margin-left: auto;
          margin-right: auto;
          text-align: center;
          color: var(--primary-text-color);
        }
        .current-badge {
          display: inline-block;
          padding: 1px 8px;
          border-radius: 999px;
          background: var(--secondary-background-color, var(--divider-color));
          font-variant-numeric: tabular-nums;
        }
        .warning {
          font-size: 12px;
          color: var(--error-color, #db4437);
          margin-bottom: 8px;
        }
        .slider {
          position: relative;
          height: 36px;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        .track {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 6px;
          margin-top: -3px;
          border-radius: 999px;
          background: var(--disabled-text-color, var(--divider-color));
          opacity: 0.45;
          pointer-events: none;
        }
        .range {
          position: absolute;
          top: 50%;
          height: 6px;
          margin-top: -3px;
          border-radius: 999px;
          background: var(--primary-color);
          pointer-events: none;
        }
        .current-marker {
          position: absolute;
          top: 50%;
          width: 2px;
          height: 18px;
          margin-top: -9px;
          margin-left: -1px;
          background: var(--accent-color, var(--state-active-color, var(--primary-text-color)));
          border-radius: 1px;
          pointer-events: none;
          z-index: 1;
          opacity: 0.85;
          box-shadow: 0 0 0 1px var(--card-background-color, transparent);
        }
        .current-marker[hidden] { display: none; }
        .thumb {
          position: absolute;
          top: 50%;
          width: 22px;
          height: 22px;
          margin-top: -11px;
          margin-left: -11px;
          border-radius: 50%;
          background: var(--primary-color);
          border: 2px solid var(--card-background-color, #fff);
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
          cursor: grab;
          touch-action: none;
          z-index: 2;
          box-sizing: border-box;
        }
        .thumb:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .thumb.dragging,
        .thumb:active { cursor: grabbing; z-index: 3; }
        .scale {
          display: flex;
          justify-content: space-between;
          margin-top: 2px;
          font-size: 11px;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }
      </style>
      ${wrapStart}
          ${showHeader ? `
          <div class="header${title ? "" : " no-title"}">
            ${title ? `<div class="title">${this._escape(title)}</div>` : ""}
            <div class="values" id="values">–</div>
          </div>` : `<div class="values" id="values" style="text-align:right;margin-bottom:4px;">–</div>`}
          <div class="warning" id="warning" hidden></div>
          <div class="meta">
            <span id="lbl-min"></span>
            <span class="current" id="lbl-current"></span>
            <span id="lbl-max"></span>
          </div>
          <div class="slider" id="slider">
            <div class="track"></div>
            <div class="range" id="range"></div>
            <div class="current-marker" id="current-marker" hidden></div>
            <div class="thumb" id="thumb-min" role="slider" tabindex="0"></div>
            <div class="thumb" id="thumb-max" role="slider" tabindex="0"></div>
          </div>
          <div class="scale">
            <span id="scale-min"></span>
            <span id="scale-max"></span>
          </div>
      ${wrapEnd}
    `;

    this._el = {
      slider: this._root.getElementById("slider"),
      range: this._root.getElementById("range"),
      marker: this._root.getElementById("current-marker"),
      thumbMin: this._root.getElementById("thumb-min"),
      thumbMax: this._root.getElementById("thumb-max"),
      values: this._root.getElementById("values"),
      lblMin: this._root.getElementById("lbl-min"),
      lblMax: this._root.getElementById("lbl-max"),
      lblCurrent: this._root.getElementById("lbl-current"),
      scaleMin: this._root.getElementById("scale-min"),
      scaleMax: this._root.getElementById("scale-max"),
      warning: this._root.getElementById("warning"),
    };

    this._el.thumbMin.setAttribute("aria-label", this._minLabel());
    this._el.thumbMax.setAttribute("aria-label", this._maxLabel());

    this._bindPointer(this._el.thumbMin, "min");
    this._bindPointer(this._el.thumbMax, "max");
    this._el.slider.addEventListener("pointerdown", (ev) => this._onTrackPointerDown(ev));
    this._el.thumbMin.addEventListener("keydown", (ev) => this._onKey(ev, "min"));
    this._el.thumbMax.addEventListener("keydown", (ev) => this._onKey(ev, "max"));

    this._rendered = true;
    this._syncFromHass();
  }

  _escape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _locale() {
    const loc = this._hass && this._hass.locale;
    return (loc && (loc.language || loc.locale)) || undefined;
  }

  _fmt(n) {
    if (!Number.isFinite(n)) return "–";
    const digits = this._decimals();
    try {
      return n.toLocaleString(this._locale(), {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0,
      });
    } catch (e) {
      return String(Number(n.toFixed(digits)));
    }
  }

  _fmtWithUnit(n) {
    const formatted = this._fmt(n);
    if (formatted === "–") return formatted;
    const unit = this._unit();
    return unit ? `${formatted} ${unit}` : formatted;
  }

  _pctToValue(pct) {
    const lo = this._scaleMin();
    const hi = this._scaleMax();
    return this._roundToStep(lo + (pct / 100) * (hi - lo));
  }

  _valueToPct(v) {
    const lo = this._scaleMin();
    const hi = this._scaleMax();
    if (hi <= lo) return 0;
    return ((v - lo) / (hi - lo)) * 100;
  }

  _clientXToValue(clientX) {
    const rect = this._el.slider.getBoundingClientRect();
    const w = rect.width || 1;
    const pct = this._clamp(((clientX - rect.left) / w) * 100, 0, 100);
    return this._clamp(this._pctToValue(pct), this._scaleMin(), this._scaleMax());
  }

  _missingEntities() {
    const missing = [];
    if (!this._hass) return missing;
    for (const key of ["min_entity", "max_entity", "current_entity"]) {
      const id = this._config && this._config[key];
      if (id && !this._entityState(id)) missing.push(id);
    }
    return missing;
  }

  _applyVisual() {
    if (!this._el || this._minVal == null || this._maxVal == null) return;
    const minPct = this._valueToPct(this._minVal);
    const maxPct = this._valueToPct(this._maxVal);
    this._el.thumbMin.style.left = minPct + "%";
    this._el.thumbMax.style.left = maxPct + "%";
    this._el.range.style.left = minPct + "%";
    this._el.range.style.width = Math.max(0, maxPct - minPct) + "%";
    this._el.thumbMin.setAttribute("aria-valuemin", String(this._scaleMin()));
    this._el.thumbMin.setAttribute("aria-valuemax", String(this._maxVal - this._gap()));
    this._el.thumbMin.setAttribute("aria-valuenow", String(this._minVal));
    this._el.thumbMax.setAttribute("aria-valuemin", String(this._minVal + this._gap()));
    this._el.thumbMax.setAttribute("aria-valuemax", String(this._scaleMax()));
    this._el.thumbMax.setAttribute("aria-valuenow", String(this._maxVal));

    const cur = this._currentValue();
    if (Number.isFinite(cur)) {
      const pct = this._clamp(this._valueToPct(cur), 0, 100);
      this._el.marker.hidden = false;
      this._el.marker.style.left = pct + "%";
    } else {
      this._el.marker.hidden = true;
    }
  }

  _updateLabels() {
    if (!this._el) return;
    const minV = this._minVal;
    const maxV = this._maxVal;
    this._el.values.textContent = `${this._fmtWithUnit(minV)} – ${this._fmtWithUnit(maxV)}`;
    this._el.lblMin.textContent = `${this._minLabel()} ${this._fmtWithUnit(minV)}`;
    this._el.lblMax.textContent = `${this._maxLabel()} ${this._fmtWithUnit(maxV)}`;
    this._el.scaleMin.textContent = this._fmtWithUnit(this._scaleMin());
    this._el.scaleMax.textContent = this._fmtWithUnit(this._scaleMax());

    if (this._currentEntityId()) {
      const cur = this._currentValue();
      const text = `${this._currentLabel()} ${this._fmtWithUnit(cur)}`;
      this._el.lblCurrent.innerHTML = `<span class="current-badge">${this._escape(text)}</span>`;
    } else {
      this._el.lblCurrent.textContent = "";
    }

    const missing = this._missingEntities();
    if (missing.length) {
      this._el.warning.hidden = false;
      this._el.warning.textContent = "Entity not found: " + missing.join(", ");
    } else {
      this._el.warning.hidden = true;
      this._el.warning.textContent = "";
    }
  }

  _bindPointer(el, which) {
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._startDrag(which, ev);
    });
  }

  _onTrackPointerDown(ev) {
    if (ev.target === this._el.thumbMin || ev.target === this._el.thumbMax) return;
    ev.preventDefault();
    const v = this._clientXToValue(ev.clientX);
    const dMin = Math.abs(v - this._minVal);
    const dMax = Math.abs(v - this._maxVal);
    const which = dMin <= dMax ? "min" : "max";
    this._startDrag(which, ev);
    this._moveDrag(ev.clientX);
  }

  _startDrag(which, ev) {
    this._dragging = which;
    this._el.thumbMin.classList.toggle("dragging", which === "min");
    this._el.thumbMax.classList.toggle("dragging", which === "max");
    const thumb = which === "min" ? this._el.thumbMin : this._el.thumbMax;
    try {
      thumb.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* ignore */
    }
    this._pointerId = ev.pointerId;
    this._onMove = (e) => {
      if (e.pointerId !== this._pointerId) return;
      e.preventDefault();
      this._moveDrag(e.clientX);
    };
    this._onUp = (e) => {
      if (e.pointerId !== this._pointerId) return;
      this._endDrag();
    };
    window.addEventListener("pointermove", this._onMove, { passive: false });
    window.addEventListener("pointerup", this._onUp);
    window.addEventListener("pointercancel", this._onUp);
  }

  _moveDrag(clientX) {
    const v = this._clientXToValue(clientX);
    const gap = this._gap();
    if (this._dragging === "min") {
      this._minVal = this._clamp(v, this._scaleMin(), this._maxVal - gap);
    } else if (this._dragging === "max") {
      this._maxVal = this._clamp(v, this._minVal + gap, this._scaleMax());
    }
    this._applyVisual();
    this._updateLabels();
  }

  _endDragListeners() {
    if (this._onMove) window.removeEventListener("pointermove", this._onMove);
    if (this._onUp) {
      window.removeEventListener("pointerup", this._onUp);
      window.removeEventListener("pointercancel", this._onUp);
    }
    this._onMove = null;
    this._onUp = null;
    this._pointerId = null;
  }

  _endDrag() {
    this._endDragListeners();
    if (this._el) {
      this._el.thumbMin.classList.remove("dragging");
      this._el.thumbMax.classList.remove("dragging");
    }
    const which = this._dragging;
    this._dragging = null;
    this._commit(which);
  }

  _onKey(ev, which) {
    const keys = {
      ArrowLeft: -this._step(),
      ArrowDown: -this._step(),
      ArrowRight: this._step(),
      ArrowUp: this._step(),
      PageDown: -5 * this._step(),
      PageUp: 5 * this._step(),
      Home: "min",
      End: "max",
    };
    if (!(ev.key in keys)) return;
    ev.preventDefault();
    const gap = this._gap();
    if (which === "min") {
      if (keys[ev.key] === "min") this._minVal = this._scaleMin();
      else if (keys[ev.key] === "max") this._minVal = this._maxVal - gap;
      else this._minVal = this._clamp(this._minVal + keys[ev.key], this._scaleMin(), this._maxVal - gap);
    } else {
      if (keys[ev.key] === "min") this._maxVal = this._minVal + gap;
      else if (keys[ev.key] === "max") this._maxVal = this._scaleMax();
      else this._maxVal = this._clamp(this._maxVal + keys[ev.key], this._minVal + gap, this._scaleMax());
    }
    this._minVal = this._roundToStep(this._minVal);
    this._maxVal = this._roundToStep(this._maxVal);
    this._applyVisual();
    this._updateLabels();
    this._commit(which);
  }

  _serviceFor(entityId) {
    const domain = String(entityId || "").split(".")[0];
    if (domain === "number") return ["number", "set_value"];
    return ["input_number", "set_value"];
  }

  _commit(which) {
    if (!this._hass || typeof this._hass.callService !== "function") return;
    const map = {
      min: [this._config.min_entity, this._minVal],
      max: [this._config.max_entity, this._maxVal],
    };
    const targets = which ? [map[which]] : [map.min, map.max];
    for (const [entityId, value] of targets) {
      if (!entityId || !Number.isFinite(value)) continue;
      const current = this._entityNum(entityId, NaN);
      if (current === value) continue;
      const st = this._entityState(entityId);
      if (!st) continue;
      const [domain, service] = this._serviceFor(entityId);
      this._hass.callService(domain, service, {
        entity_id: entityId,
        value: value,
      });
    }
  }
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, DualRangeSliderCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: "Dual Range Slider Card",
    description: "Dual-handle range slider for input_number or number entities.",
    preview: true,
  });
}

console.info(
  `%c DUAL-RANGE-SLIDER-CARD %c ${CARD_VERSION} `,
  "background:#03a9f4;color:#fff;padding:2px 4px;border-radius:2px 0 0 2px;",
  "background:#27303a;color:#fff;padding:2px 4px;border-radius:0 2px 2px 0;"
);
