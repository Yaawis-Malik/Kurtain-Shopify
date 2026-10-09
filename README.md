# Made-to-Measure Curtain Configurator (Shopify OS 2.0)

A custom PDP section for Shopify Dawn (any Online Store 2.0 theme) that prices a curtain from its width and drop, picks the right number of fabric panels, and adds it to the cart with full order integrity.

**Live preview:** https://kurtain-eur9gxrj.myshopify.com/products/made-to-measure-curtain (password sent separately)

- Vanilla ES2020 + a `<curtain-configurator>` custom element. No jQuery, no external libraries.
- All pricing rules live in a Shopify Metaobject. Nothing about widths, panels or prices is hardcoded in Liquid or JS.
- Cart add goes through `/cart/add.js`; the drawer refreshes via the Section Rendering API.

## Files

| Path | Purpose |
| --- | --- |
| `sections/curtain-configurator.liquid` | Section markup, block-based swatches, schema, serializes metaobject + variant data to JSON |
| `assets/curtain-configurator.js` | The `<curtain-configurator>` custom element (pricing, validation, cart add) |
| `assets/curtain-configurator.css` | Styles with reserved space for every dynamic element |
| `templates/product.curtain.json` | Product template containing only the configurator section, which is a complete PDP (gallery, title, price, configurator, details) |
| `setup/*.graphql`, `setup/metaobject-schema.json` | Metaobject schema as code, and a reference export |

## Setup on a fresh store

1. **Install the theme files.** Copy the folders' contents into a Dawn theme (or `shopify theme push`). The section works in any OS 2.0 theme; the cart refresh is tuned for Dawn's `cart-drawer` / `cart-notification` and falls back to the cart page elsewhere.
2. **Create the metaobject definition.** Admin > Settings > Custom data > Metaobjects > Add definition, named **Curtain Pricing Tier** (type `curtain_pricing_tier`). Add these fields:
   - `min_width` Integer (cm)
   - `max_width` Integer (cm)
   - `panels_required` Integer
   - `base_price` Decimal
   - `price_per_drop_tier` Decimal

   Enable **Storefronts** access. Or run `setup/01-create-definition.graphql` in the GraphiQL app.
3. **Add at least 3 entries** (or run `setup/02-create-entries.graphql`):

   | Width range | Panels | Base price | Per drop tier |
   | --- | --- | --- | --- |
   | 50-120 cm | 1 | 80.00 | 10.00 |
   | 121-240 cm | 2 | 140.00 | 18.00 |
   | 241-360 cm | 3 | 210.00 | 28.00 |

4. **Create the product metafield.** Settings > Custom data > Products > Add definition: namespace/key `custom.curtain_pricing_tiers`, type **Metaobject > List of Curtain Pricing Tier entries** (or `setup/03-create-product-metafield.graphql`).
5. **Create the test product** with two options: **Drop** (`150cm`, `200cm`, `250cm`) and **Color** (`Ivory`, `Sage`, `Slate`). Fill the `Curtain pricing tiers` metafield with all three entries.
6. **Assign the template.** Product > Theme template > `product.curtain`.
7. **Swatches.** In the theme editor, open the Curtain configurator section and set each swatch block's name to match a Color option value exactly. Optional fabric image per swatch.

The Drop option name and Color option name are section settings, so other stores can use different names.

## How the price is calculated

```
tier        = the metaobject entry where min_width <= width <= max_width
dropIndex   = position of the selected drop in the ascending list of Drop option values
unit price  = tier.base_price + tier.price_per_drop_tier * dropIndex
```

Worked example with the sample data: width 180 cm, drop 200 cm.
Tier 121-240 applies (2 panels). Drop 200 is index 1 of [150, 200, 250].
`140.00 + 18.00 * 1 = 158.00`, `_fabric_panels = 2`.

Notes:
- Prices are converted to integer cents (`round(price * 100)`) in Liquid so the JS never does floating point money math.
- The allowed width range (for example 50-360) is derived from the smallest `min_width` and largest `max_width` in the entries. Change the metaobject and the validation changes with it.
- Width must be a whole number. A width that falls in a gap between tiers is rejected with a message.
- Drop intervals come from the product's Drop option values, so the dropdown, the price tier and the variant stay in sync.

## Cart payload and technical decisions

`POST /cart/add.js`:

```json
{
  "items": [{
    "id": 4412345678901,
    "quantity": 1,
    "properties": {
      "Width": "180cm",
      "Drop": "200cm",
      "_fabric_panels": "2",
      "_calculated_price": "158.00"
    }
  }],
  "sections": "cart-drawer,cart-icon-bubble",
  "sections_url": "/products/made-to-measure-curtain"
}
```

- **Variant = Drop + Color.** The line item points at the real variant matching the selected drop and fabric. Fabric panels are never a variant option or a visible dropdown.
- **Visible properties** `Width` and `Drop` show in the cart, checkout and order emails. **Private properties** start with an underscore (`_fabric_panels`, `_calculated_price`): Shopify hides them from storefront and standard invoice templates but keeps them in the order JSON for fulfilment.
- **Section Rendering API.** The section asks the cart component (`getSectionsToRender()`) which sections it needs and sends them in the same `/cart/add.js` request, so there is one round trip and no second fetch. The response is handed to Dawn's `renderContents()`. On themes without that component the cart bubble is refreshed and the shopper goes to the cart page.
- **Zero CLS.** The price block, validation message area, debug line and button have fixed or minimum heights; numbers use tabular figures; the button is full width so label changes cannot reflow. Updates only change text and fade opacity (disabled under `prefers-reduced-motion`).
- **Panels are hidden from shoppers.** The panel count is computed live but only shown when the "Show fabric panel count" setting is on (or inside the theme editor), for reviewers.
- **Accessibility.** Native inputs and radios, visible focus, `aria-invalid`, and a `role="status"` message region.

## Known limitation: checkout price

`/cart/add.js` cannot set a custom price. The storefront shows the calculated price, but the cart line uses the selected variant's price. Making checkout match the configurator needs one of:

1. **Cart Transform Function** that recomputes the price from the metaobject entries and the `Width` / `Drop` properties (do not trust `_calculated_price` alone, it is client-supplied). Check plan availability for price updates in your Shopify plan.
2. **Pre-built variants** at fixed prices, only viable with a small, fixed set of sizes.
3. A server-side step that creates a draft order or one-off variant.

`_calculated_price` and `_fabric_panels` are sent so a Function or a post-order validation webhook can compare them with a server-side recomputation. In production, always re-derive panels and price on the server; the browser value is for display and fulfilment hints only.
