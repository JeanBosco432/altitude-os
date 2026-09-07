import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    const admin = createClient(url, serviceRoleKey)

    // Remove private trade screenshots first.
    const { data: files } = await admin.storage.from('trade-media').list(user.id, { limit: 1000 })
    if (files?.length) {
      const paths: string[] = []
      for (const folder of files) {
        const { data: nested } = await admin.storage.from('trade-media').list(`${user.id}/${folder.name}`, { limit: 1000 })
        for (const item of nested || []) paths.push(`${user.id}/${folder.name}/${item.name}`)
      }
      if (paths.length) await admin.storage.from('trade-media').remove(paths)
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
