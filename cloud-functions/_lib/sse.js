export function sseEvent({ step, status, summary, payload = {}, ts = Date.now() }) {
  const body = JSON.stringify({ step, status, summary, payload, ts });
  return `data: ${body}\n\n`;
}

export function sseResponse(generator) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of generator) {
          controller.enqueue(encoder.encode(sseEvent(event)));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sseEvent({
              step: 'error',
              status: 'error',
              summary: err?.message || 'Internal error',
              payload: {},
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}
