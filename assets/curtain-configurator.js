/**
 * <curtain-configurator>
 * Vanilla ES2020 custom element. No jQuery, no libraries.
 *
 * All pricing rules come from the Curtain Pricing Tier metaobjects, serialized
 * by the Liquid section into a JSON block. Nothing about widths, panels or
 * prices is hardcoded here.
 */
const CC_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

class CurtainConfigurator extends HTMLElement {
  initGallery() {
    const stage = this.querySelector('[data-cc-stage]');
    const thumbs = [...this.querySelectorAll('[data-cc-thumb]')];
    if (!stage || !thumbs.length) return;
    thumbs.forEach((thumb) => {
      thumb.addEventListener('click', () => {
        stage.removeAttribute('srcset');
        stage.src = thumb.dataset.src;
        thumbs.forEach((t) => t.removeAttribute('aria-current'));
        thumb.setAttribute('aria-current', 'true');
      });
    });
  }

  connectedCallback() {
    if (!this.galleryReady) {
      this.galleryReady = true;
      this.initGallery();
    }
    const configEl = this.querySelector('[data-cc-config]');
    if (!configEl || this.ready) return;
    this.ready = true;

    this.config = JSON.parse(configEl.textContent);
    this.form = this.querySelector('[data-cc-form]');
    this.widthField = this.querySelector('[data-cc-width-field]');
    this.widthInput = this.querySelector('[data-cc-width]');
    this.dropSelect = this.querySelector('[data-cc-drop]');
    this.qtyInput = this.querySelector('[data-cc-qty]');
    this.swatches = [...this.querySelectorAll('[data-cc-swatch]')];
    this.colorNameEl = this.querySelector('[data-cc-color-name]');
    this.priceEl = this.querySelector('[data-cc-price]');
    this.statusEl = this.querySelector('[data-cc-status]');
    this.debugEl = this.querySelector('[data-cc-debug]');
    this.submitBtn = this.querySelector('[data-cc-submit]');
    this.submitLabel = this.querySelector('[data-cc-submit-label]');

    this.fmt = new Intl.NumberFormat(this.config.locale, {
      style: 'currency',
      currency: this.config.currency
    });

    this.tiers = this.config.tiers.filter(
      (t) => Number.isInteger(t.min) && Number.isInteger(t.max)
    );
    if (!this.tiers.length) {
      this.statusEl.textContent = 'Pricing is not set up for this product yet.';
      return;
    }

    // Allowed width range is derived from the metaobject entries.
    this.bounds = {
      min: Math.min(...this.tiers.map((t) => t.min)),
      max: Math.max(...this.tiers.map((t) => t.max))
    };
    this.fromCents = Math.min(...this.tiers.map((t) => t.baseCents));
    this.drops = this.config.dropValues.map((v) => parseInt(v, 10)).sort((a, b) => a - b);

    this.widthInput.min = this.bounds.min;
    this.widthInput.max = this.bounds.max;
    this.widthInput.placeholder = `${this.bounds.min}-${this.bounds.max}`;

    this.addEventListener('input', (e) => {
      if (e.target === this.widthInput || e.target === this.qtyInput) this.update();
    });
    this.addEventListener('change', (e) => {
      if (e.target === this.dropSelect || this.swatches.includes(e.target)) this.update();
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addToCart();
    });

    this.update();
  }

  /* ---------- state ---------- */

  findVariant(dropValue, color) {
    const { dropIndex, colorIndex, variants } = this.config;
    return variants.find(
      (v) =>
        (dropIndex < 0 || v.options[dropIndex] === dropValue) &&
        (colorIndex < 0 || color === null || v.options[colorIndex] === color)
    );
  }

  readState() {
    const rawWidth = this.widthInput.value.trim();
    const dropValue = this.dropSelect.value;
    const drop = parseInt(dropValue, 10);
    const dropTierIndex = Math.max(0, this.drops.indexOf(drop));
    const color = this.swatches.find((s) => s.checked)?.value ?? null;
    const quantity = Math.max(1, parseInt(this.qtyInput.value, 10) || 1);
    const { min, max } = this.bounds;
    const s = { rawWidth, dropValue, drop, color, quantity, kind: 'ready', message: '' };

    if (this.widthInput.validity.badInput) {
      return { ...s, kind: 'invalid', message: 'Width must be a whole number of centimetres.' };
    }
    if (!rawWidth) {
      return { ...s, kind: 'idle', message: `Enter a width from ${min} to ${max} cm.` };
    }

    const width = Number(rawWidth);
    if (!Number.isInteger(width)) {
      return { ...s, kind: 'invalid', message: 'Width must be a whole number of centimetres.' };
    }
    if (width < min || width > max) {
      return { ...s, width, kind: 'invalid', message: `Width must be between ${min} and ${max} cm.` };
    }

    const tier = this.tiers.find((t) => width >= t.min && width <= t.max);
    if (!tier) {
      return { ...s, width, kind: 'invalid', message: 'No price is set for this width. Try a nearby size.' };
    }

    const unitCents = tier.baseCents + tier.perDropCents * dropTierIndex;
    const priced = { ...s, width, tier, unitCents };
    const variant = this.findVariant(dropValue, color);

    if (!variant) {
      return { ...priced, kind: 'unavailable', message: 'This fabric is not offered in this drop.' };
    }
    if (!variant.available) {
      return { ...priced, variant, kind: 'soldout', message: 'This fabric and drop is sold out.' };
    }
    return { ...priced, variant };
  }

  /* ---------- rendering (no layout shift: every element has reserved space) ---------- */

  setText(el, text) {
    if (!el || el.textContent === text) return;
    el.textContent = text;
    if (!CC_REDUCED_MOTION.matches && el.animate) {
      el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
  }

  update() {
    const s = (this.state = this.readState());
    const hasPrice = s.unitCents != null;
    const price = hasPrice
      ? this.fmt.format(s.unitCents / 100)
      : `From ${this.fmt.format(this.fromCents / 100)}`;

    this.setText(this.priceEl, price);
    if (this.colorNameEl) this.colorNameEl.textContent = s.color ?? '';

    const invalid = s.kind === 'invalid';
    this.widthField.toggleAttribute('data-invalid', invalid);
    this.widthInput.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    this.statusEl.textContent = s.message;
    this.statusEl.dataset.kind = s.kind;

    if (this.debugEl) {
      this.debugEl.textContent = `Fabric panels: ${s.tier ? s.tier.panels : '-'}`;
    }

    let label = this.config.addLabel;
    if (s.kind === 'ready') {
      label = `${this.config.addLabel} \u00B7 ${this.fmt.format((s.unitCents * s.quantity) / 100)}`;
    } else if (s.kind === 'soldout') {
      label = this.config.soldOutLabel;
    }
    this.setText(this.submitLabel, label);
    this.submitBtn.disabled = s.kind !== 'ready';
  }

  /* ---------- cart ---------- */

  buildPayload(s, sections) {
    return {
      items: [
        {
          id: s.variant.id,
          quantity: s.quantity,
          properties: {
            // Visible to the customer
            Width: `${s.width}cm`,
            Drop: `${s.drop}cm`,
            // Private: the leading underscore hides these on storefront and
            // invoice templates, but they stay in the order JSON.
            _fabric_panels: String(s.tier.panels),
            _calculated_price: (s.unitCents / 100).toFixed(2)
          }
        }
      ],
      sections: sections.join(','),
      sections_url: window.location.pathname
    };
  }

  async addToCart() {
    const s = this.state;
    if (!s || s.kind !== 'ready' || this.busy) return;
    this.setBusy(true);

    const cartEl = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
    const sections = cartEl?.getSectionsToRender
      ? cartEl.getSectionsToRender().map((x) => x.id)
      : ['cart-icon-bubble'];

    try {
      const res = await fetch(this.config.cartAddUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(this.buildPayload(s, sections))
      });
      const data = await res.json();
      if (!res.ok || data.status) {
        throw new Error(data.description || data.message || 'Could not add to cart.');
      }
      this.refreshCart(cartEl, data);
      this.dispatchEvent(new CustomEvent('curtain:added', { bubbles: true, detail: data }));
    } catch (err) {
      this.statusEl.textContent = err.message;
      this.statusEl.dataset.kind = 'invalid';
    } finally {
      this.setBusy(false);
    }
  }

  refreshCart(cartEl, data) {
    const first = data.items?.[0];
    const state = { ...data, id: first?.id, key: first?.key };

    // Dawn's cart drawer / notification re-render themselves from the
    // Section Rendering API HTML returned with /cart/add.js.
    if (cartEl && typeof cartEl.renderContents === 'function') {
      cartEl.renderContents(state);
      return;
    }

    // Generic fallback: refresh the cart bubble, then send the shopper to the cart page.
    const bubbleHtml = data.sections?.['cart-icon-bubble'];
    const bubble = document.getElementById('cart-icon-bubble');
    if (bubbleHtml && bubble) {
      const doc = new DOMParser().parseFromString(bubbleHtml, 'text/html');
      const next = doc.querySelector('.shopify-section');
      if (next) bubble.innerHTML = next.innerHTML;
    }
    window.location.assign(this.config.cartUrl);
  }

  setBusy(busy) {
    this.busy = busy;
    this.submitBtn.setAttribute('aria-busy', String(busy));
    this.submitBtn.disabled = busy || this.state?.kind !== 'ready';
    if (busy) this.setText(this.submitLabel, 'Adding\u2026');
    else this.update();
  }
}

if (!customElements.get('curtain-configurator')) {
  customElements.define('curtain-configurator', CurtainConfigurator);
}
