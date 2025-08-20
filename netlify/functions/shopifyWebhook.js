// netlify/functions/shopifyWebhook.js
const crypto = require("crypto");
const fetch = require("node-fetch");

// ENV VARS (set in Netlify → Site Settings → Environment Variables)
const META_PIXEL_ID = process.env.META_PIXEL_ID;           // e.g. 4321219291479784
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;   // Your Meta CAPI token
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || ""; 
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || ""; // optional (for testing)

function sha256(v) {
  return crypto
    .createHash("sha256")
    .update(String(v || "").trim().toLowerCase())
    .digest("hex");
}

function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!secret) return true; // skip if not set
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const h = Buffer.from(hmacHeader || "", "utf8");
  const d = Buffer.from(digest, "utf8");
  return h.length === d.length && crypto.timingSafeEqual(d, h);
}

exports.handler = async (event) => {
  try {
    // Verify Shopify HMAC
    const hmacHeader =
      event.headers["x-shopify-hmac-sha256"] || event.headers["X-Shopify-Hmac-Sha256"];
    if (!verifyShopifyHmac(event.body || "", hmacHeader, SHOPIFY_WEBHOOK_SECRET)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid HMAC" }) };
    }

    const order = JSON.parse(event.body || "{}");

    // Only fire if payment is captured
    if (order.financial_status !== "paid") {
      return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: "not paid" }) };
    }

    // ----- IDENTIFIERS -----
    const email = (order.email || (order.customer && order.customer.email) || "").trim();
    const phoneRaw = (
      order.phone ||
      (order.billing_address && order.billing_address.phone) ||
      (order.customer && order.customer.phone) ||
      ""
    ).replace(/\D/g, "");

    // Pull fbp/fbc from note_attributes (set via Customer Events script)
    const noteAttrs = Object.fromEntries(
      (order.note_attributes || []).map((a) => [a.name, a.value])
    );
    const fbp = noteAttrs._fbp || undefined;
    const fbc = noteAttrs._fbc || undefined;

    // Deduplication key: match browser (checkout.id)
    const eventId = String(order.checkout_id || order.id);

    // ----- VALUES -----
    const currency = order.currency || "USD";
    const value = Number(order.total_price || 0);

    const contents = (order.line_items || []).map((li) => ({
      id: li.sku || String(li.variant_id || li.product_id || ""),
      quantity: li.quantity || 1,
      item_price: Number(li.price || 0),
    }));

    const event_time = Math.floor(
      new Date(order.processed_at || order.updated_at || Date.now()).getTime() / 1000
    );

    const eventData = {
      event_name: "Purchase",
      event_time,
      action_source: "website",
      event_id: eventId,
      event_source_url: order.landing_site || undefined,
      user_data: {
        em: email ? sha256(email) : undefined,
        ph: phoneRaw ? sha256(phoneRaw) : undefined,
        fbp,
        fbc,
      },
      custom_data: {
        currency,
        value,
        contents,
        num_items: contents.reduce((s, c) => s + (c.quantity || 0), 0),
        content_type: "product",
      },
    };

    const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(
      META_ACCESS_TOKEN
    )}`;
    const body = META_TEST_EVENT_CODE
      ? JSON.stringify({ data: [eventData], test_event_code: META_TEST_EVENT_CODE })
      : JSON.stringify({ data: [eventData] });

    const fbRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const fbJson = await fbRes.json();

    if (!fbRes.ok) {
      console.error("Meta CAPI error", fbJson);
      return { statusCode: 502, body: JSON.stringify({ error: "Meta CAPI failed", details: fbJson }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, event_id: eventId, fb: fbJson }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: err.message }) };
  }
};
