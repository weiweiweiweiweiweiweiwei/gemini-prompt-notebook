/**
 * 特務P：Google 登入的 token 中繼（Supabase Edge Function）
 *
 * 為什麼需要它：提示詞存在使用者自己的 Google 雲端硬碟，瀏覽器直接和 Google 溝通，
 * 但「用登入回來的 code 換 token」「token 過期換新的」這兩步，Google 規定要附用戶端密鑰，
 * 而密鑰不能放在網頁或外掛裡（任何人都看得到）。所以只有這兩步經過這裡。
 *
 * 它做的事只有：收到 code 或 refresh token → 加上密鑰轉給 Google → 把 Google 的回覆原樣交回。
 * 不碰雲端硬碟、不保存任何東西、不記錄 token。
 *
 * 需要在 Supabase 後台 → Edge Functions → Secrets 設定：
 *   GOOGLE_CLIENT_ID      OAuth 用戶端 ID（和 cloud-config.js 的 clientId 一樣）
 *   GOOGLE_CLIENT_SECRET  OAuth 用戶端密鑰
 *
 * 部署時關掉 JWT 驗證（verify_jwt = false）：呼叫的人還沒登入，而且網頁版用的新式公開金鑰
 * （sb_publishable_）不是 JWT。安全性靠 Google 本身——沒有有效的 code／refresh token，換不到任何東西。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !secret) {
    return reply({ error: 'server_not_configured', error_description: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'invalid_request' }, 400);
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  const form = new URLSearchParams({ client_id: clientId, client_secret: secret });
  if (str(body.code)) {
    form.set('grant_type', 'authorization_code');
    form.set('code', str(body.code));
    form.set('code_verifier', str(body.code_verifier));
    form.set('redirect_uri', str(body.redirect_uri));
  } else if (str(body.refresh_token)) {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', str(body.refresh_token));
  } else {
    return reply({ error: 'invalid_request' }, 400);
  }

  let res: Response;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
  } catch {
    return reply({ error: 'google_unreachable' }, 502);
  }
  const out = await res.json().catch(() => ({ error: 'bad_gateway' }));

  // 只交回瀏覽器需要的欄位
  if (!res.ok) return reply({ error: out.error, error_description: out.error_description }, res.status);
  return reply({
    access_token: out.access_token,
    expires_in: out.expires_in,
    refresh_token: out.refresh_token,
    scope: out.scope,
    id_token: out.id_token,
    token_type: out.token_type,
  });
});
