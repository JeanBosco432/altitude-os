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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } })
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) throw new Error('Unauthorized')

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
    const priceId = Deno.env.get('STRIPE_PRICE_ID')
    const appUrl = Deno.env.get('APP_URL')
    if (!stripeSecret || !priceId || !appUrl) throw new Error('Billing is not configured')

    const stripe = new Stripe(stripeSecret)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: user.id,
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${appUrl}${appUrl.includes('?') ? '&' : '?'}billing=success`,
      cancel_url: `${appUrl}${appUrl.includes('?') ? '&' : '?'}billing=cancelled`,
      allow_promotion_codes: true,
    })

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
