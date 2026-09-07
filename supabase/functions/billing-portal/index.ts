import Stripe from 'npm:stripe@18'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) throw new Error('Unauthorized')
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) throw new Error('Unauthorized')

    const admin = createClient(url, service)
    const { data: sub } = await admin.from('subscriptions').select('provider_customer_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!sub?.provider_customer_id) throw new Error('No billing customer found')

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
    const appUrl = Deno.env.get('APP_URL')
    if (!stripeSecret || !appUrl) throw new Error('Billing is not configured')
    const stripe = new Stripe(stripeSecret)
    const session = await stripe.billingPortal.sessions.create({ customer: sub.provider_customer_id, return_url: appUrl })
    return new Response(JSON.stringify({ url: session.url }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
