import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify'

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error({ err: error, url: request.url }, 'Request error')

  // Validation errors (Zod / Fastify schema)
  if (error.validation) {
    return reply.code(400).send({
      ok: false,
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: error.validation,
    })
  }

  // Rate limit
  if (error.statusCode === 429) {
    return reply.code(429).send({
      ok: false,
      error: 'Too many requests',
      code: 'RATE_LIMITED',
    })
  }

  // JWT / auth errors
  if (error.statusCode === 401) {
    return reply.code(401).send({
      ok: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    })
  }

  // Not found
  if (error.statusCode === 404) {
    return reply.code(404).send({
      ok: false,
      error: 'Not found',
      code: 'NOT_FOUND',
    })
  }

  // Default 500
  const statusCode = error.statusCode ?? 500
  return reply.code(statusCode).send({
    ok: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    code: 'INTERNAL_ERROR',
  })
}
