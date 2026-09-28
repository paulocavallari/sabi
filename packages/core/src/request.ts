import type { ChatRequestBody, RouteDecision, SabiConfig } from './types.ts'

/**
 * Build the request that the proxy will actually send upstream.
 *
 * This is deliberately a pure shallow-envelope transform. Message/tool values
 * stay opaque and are never rewritten. Compatibility checks and dispatch must
 * use this same helper so generated fields cannot bypass the gate.
 */
export function buildEffectiveRequestEnvelope(
  config: SabiConfig,
  decision: RouteDecision,
  body: ChatRequestBody | Record<string, unknown>,
): Record<string, unknown> {
  const upstream = config.upstreams[decision.upstream]
  if (!upstream) throw new Error(`unknown upstream '${decision.upstream}'`)
  const next: Record<string, unknown> = { ...body, model: decision.upstreamModel }
  if (body.stream === true && upstream.streamUsage === true) {
    const candidate = body.stream_options
    const streamOptions = candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {}
    if (streamOptions.include_usage !== true) {
      next.stream_options = { ...streamOptions, include_usage: true }
      }
    }
    // Clamp the output ceiling to what this route can actually produce.
    //
    // `max_tokens` is an upper bound, so a client that allows 128k is served
    // happily by a route that caps at 32k -- it just gets a shorter answer.
    // Forwarding the original number to a smaller route invites a provider
    // error over a limit the client never actually needed, so the value is
    // reduced here instead. This is what makes "route it anyway" safe: the
    // chain keeps the route AND the upstream gets a number it accepts.
    const model = config.models[decision.tier]
    const ceiling = model?.maxOutputTokens
    if (ceiling !== undefined) {
      for (const key of ['max_tokens', 'max_completion_tokens'] as const) {
        const requested = next[key]
        if (typeof requested === 'number' && Number.isSafeInteger(requested) && requested > ceiling) {
          next[key] = ceiling
        }
      }
    }
  return next
}
