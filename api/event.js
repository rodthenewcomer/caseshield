const ALLOWED = new Set([
  'page_view','hero_cta_click','case_check_started','case_step_1','case_step_2','case_step_3','case_step_4','case_step_5','case_check_completed','alert_intent','pricing_view','purchase_intent_29'
]);

function clean(value, max = 90) {
  return String(value ?? '').replace(/[<>\r\n]/g, ' ').slice(0, max);
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const body = req.body || {};
  if (!ALLOWED.has(body.name)) return res.status(400).json({ ok: false });

  const event = {
    name: body.name,
    ts: new Date().toISOString(),
    session_id: clean(body.session_id, 64)
  };

  // Only validation-safe, non-sensitive product metadata is accepted.
  const allowedFields = ['source','step_id','answer','event','visa','embassy','timing','need'];
  for (const key of allowedFields) {
    if (body[key] !== undefined) event[key] = clean(body[key]);
  }

  console.log('CASESHIELD_EVENT', JSON.stringify(event));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
