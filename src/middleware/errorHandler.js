/**
 * Global error handling middleware for Express 5
 */

function errorHandler(err, req, res, _next) {
  console.error('❌ Unhandled error:', err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Express 5 throws errors differently — catch everything
  const statusCode = err.statusCode || err.status || 500;
  const message = err.expose ? err.message : 'Internal server error';

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, asyncHandler };
