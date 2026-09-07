import Stripe from 'npm:stripe@18'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get('STRIPE_SECRET_KEY')
    const signingSecret = Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if (!secret || !signingSecret) throw new Error('Stripe webhook is not configured')

    const stripe = new Stripe(secret)
    const signature = req.headers.get('stripe-signature')
    if (!signature) throw new Error('Missing Stripe signature')
    const body = await req.text()
    const event = await stripe.webhooks.constructEventAsync(body, signature, signingSecret, undefined, Stripe.createSubtleCryptoProvider())
    const db = createClient(supabaseUrl, service)

    const syncSubscription = async (sub: Stripe.Subscription) => {
      const userId = sub.metadata?.user_id
      if (!userId) return
      const active = ['active', 'trialing'].includes(sub.status)
      await db.from('subscriptions').upsert({
        user_id: userId,
        provider: 'stripe',
        provider_customer_id: String(sub.customer),
        provider_subscription_id: sub.id,
        status: sub.status,
        price_id: sub.items.data[0]?.price?.id || null,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_subscription_id' })
      await db.from('profiles').update({ plan: active ? 'pro' : 'free', updated_at: new Date().toISOString() }).eq('id', userId)
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.client_reference_id
      if (userId && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription))
        if (!sub.metadata.user_id) {
          await stripe.subscriptions.update(sub.id, { metadata: { ...sub.metadata, user_id: userId } })
          sub.metadata.user_id = userId
        }
        await syncSubscription(sub)
      }
    }
    if (['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) {
      await syncSubscription(event.data.object as Stripe.Subscription)
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
})
