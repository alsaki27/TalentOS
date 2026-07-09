interface Env {
  RENDER_HEALTHCHECK_URL: string;
}

async function pingRender(url: string): Promise<Response> {
  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "talentos-render-keepalive/1.0",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const res = await pingRender(env.RENDER_HEALTHCHECK_URL);
    return Response.json({
      ok: res.ok,
      status: res.status,
      checkedUrl: env.RENDER_HEALTHCHECK_URL,
      checkedAt: new Date().toISOString(),
    });
  },

  async scheduled(
    _controller: unknown,
    env: Env,
    _ctx: unknown
  ): Promise<void> {
    const res = await pingRender(env.RENDER_HEALTHCHECK_URL);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Render healthcheck failed (${res.status}): ${body.slice(0, 500)}`);
    }
  },
};
