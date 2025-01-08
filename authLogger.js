const logger = {
  debug: (...args) => console.log(new Date().toISOString(), '- DEBUG -', ...args),
  error: (...args) => console.error(new Date().toISOString(), '- ERROR -', ...args),
  auth: (...args) => console.log(new Date().toISOString(), '- AUTH -', ...args)
};

// Auth logging middleware
const authLoggingMiddleware = (req, res, next) => {
  logger.auth('Incoming request:', {
    path: req.path,
    method: req.method,
    headers: {
      authorization: req.headers.authorization ? 'Bearer [REDACTED]' : 'None',
      'content-type': req.headers['content-type']
    }
  });

  if (req.auth) {
    logger.auth('Authenticated user:', {
      sub: req.auth.sub,
      scope: req.auth.scope,
      permissions: req.auth.permissions
    });
  }

  next();
};

module.exports = { logger, authLoggingMiddleware };
