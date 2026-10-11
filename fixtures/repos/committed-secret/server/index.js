const express = require("express");

const app = express();
const stripeKey = "sk_live_FAKE0000demo1234567890";

app.post("/checkout", (req, res) => {
  res.json({ ok: true, keyPrefix: stripeKey.slice(0, 7) });
});

app.listen(process.env.PORT || 4000);
