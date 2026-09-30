// ALTITUDE Trade V8.1 — réception des trades envoyés par l'EA MetaTrader 5 « AltitudeSync ».
// Authentification : en-tête `x-altitude-token` (jeton généré dans ALTITUDE > Paramètres > Connexion MT5).
// Seul le hash SHA-256 du jeton est stocké en base. Aucun ordre n'est jamais passé : lecture seule.
// Déploiement : supabase functions deploy mt5-ingest --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-altitude-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MAX_POSITIONS = 200

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const str = (v: unknown, max = 120) => String(v ?? '').slice(0, max)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const iso = (v: unknown) => { const d = new Date(String(v ?? '')); return Number.isFinite(d.getTime()) ? d.toISOString() : null }

export function cleanPosition(p: Record<string, unknown>) {
  const type = str(p.type, 8).toUpperCase()
  const deals = Array.isArray(p.deals) ? p.deals.slice(0, 50).map((d: Record<string, unknown>) => ({
    time: iso(d.time), price: num(d.price), volume: num(d.volume), profit: num(d.profit),
    commission: num(d.commission), swap: num(d.swap), fee: num(d.fee), reason: str(d.reason, 16),
  })) : []
  return {
    position_id: str(p.position_id, 40),
    symbol: str(p.symbol, 40),
    type: type === 'BUY' || type === 'SELL' ? type : '',
    volume: num(p.volume),
    open_time: iso(p.open_time),
    close_time: iso(p.close_time),
    open_price: num(p.open_price),
    close_price: num(p.close_price),
    sl: num(p.sl), tp: num(p.tp),
    initial_sl: num(p.initial_sl), initial_tp: num(p.initial_tp),
    risk_money: num(p.risk_money),
    profit: num(p.profit), commission: num(p.commission), swap: num(p.swap), fee: num(p.fee), net: num(p.net),
    close_reason: str(p.close_reason, 16),
    magic: num(p.magic), comment: str(p.comment, 80),
    deals,
  }
}

type Admin = ReturnType<typeof createClient>

export async function handle(req: Request, admin: Admin): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  const token = (req.headers.get('x-altitude-token') || '').trim()
  if (token.length < 24) return json({ error: 'Jeton manquant ou invalide' }, 401)
  const hash = await sha256Hex(token)
  const { data: tokenRow, error: tokenError } = await admin
    .from('sync_tokens').select('id,user_id,revoked_at').eq('token_hash', hash).maybeSingle()
  if (tokenError) return json({ error: 'Erreur serveur' }, 500)
  if (!tokenRow || tokenRow.revoked_at) return json({ error: 'Jeton inconnu ou révoqué' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'JSON invalide' }, 400) }
  const account = (body.account || {}) as Record<string, unknown>
  const login = str(account.login, 40)
  if (!/^\d{1,20}$/.test(login)) return json({ error: 'Numéro de compte MT5 manquant' }, 400)
  const positions = Array.isArray(body.positions) ? body.positions : []
  if (positions.length > MAX_POSITIONS) return json({ error: `Maximum ${MAX_POSITIONS} positions par envoi` }, 413)

  const userId = tokenRow.user_id as string
  const now = new Date().toISOString()

  const { error: accError } = await admin.from('broker_accounts').upsert({
    user_id: userId, source: 'mt5', account_login: login,
    server: str(account.server), company: str(account.company), name: str(account.name),
    currency: str(account.currency, 8), balance: num(account.balance), equity: num(account.equity),
    ea_version: str(body.ea_version, 16), last_seen_at: now,
  }, { onConflict: 'user_id,source,account_login' })
  if (accError) return json({ error: 'Impossible d’enregistrer le compte' }, 500)

  const rows = positions
    .map((p) => cleanPosition((p || {}) as Record<string, unknown>))
    .filter((p) => p.position_id && p.type && p.symbol && p.open_time && p.close_time)
    .map((p) => ({
      user_id: userId, source: 'mt5', account_login: login, external_id: p.position_id, closed_at: p.close_time,
      payload: { ...p, account: { login, server: str(account.server), company: str(account.company), currency: str(account.currency, 8) } },
    }))

  let stored = 0
  if (rows.length) {
    const { data, error } = await admin.from('broker_inbox')
      .upsert(rows, { onConflict: 'user_id,source,account_login,external_id', ignoreDuplicates: true })
      .select('id')
    if (error) return json({ error: 'Impossible d’enregistrer les positions' }, 500)
    stored = data?.length ?? 0
  }
  await admin.from('sync_tokens').update({ last_used_at: now }).eq('id', tokenRow.id)
  return json({ ok: true, received: positions.length, accepted: rows.length, stored })
}

if (typeof Deno !== 'undefined') {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  Deno.serve((req) => handle(req, admin).catch(() => json({ error: 'Erreur inattendue' }, 500)))
}
