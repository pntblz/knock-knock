import { verifyInteraction, type Env } from './discord';
import { handleInteraction } from './interactions';
import { runTick } from './scheduler';

export default {
  // Discord ส่งคำสั่ง slash มาที่นี่ (ตั้ง URL ของ Worker เป็น Interactions Endpoint URL)
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'GET') return new Response('knock-knock ok');
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

    const body = await req.text();
    if (!(await verifyInteraction(env, req, body))) return new Response('bad signature', { status: 401 });

    const result = await handleInteraction(env, JSON.parse(body));
    return Response.json(result);
  },

  // Cron ทุกนาที
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runTick(env).then((r) => {
        if (r.sent || r.failed || r.deferred) console.log('tick', JSON.stringify(r));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
