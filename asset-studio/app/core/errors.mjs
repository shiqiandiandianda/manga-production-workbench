/**
 * 统一错误模型。
 *
 * 约束：
 * - 每个错误都有稳定的 code，前端按 code 分支，不解析 message。
 * - 每个错误都必须能回答：发生了什么、能不能重试、下一步点哪里（nextAction）。
 * - 未知错误只暴露 INTERNAL，细节写日志。
 */
export class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.code = String(code);
    this.status = Number.isInteger(options.status) ? options.status : 400;
    this.retryable = options.retryable === true;
    this.nextAction = options.nextAction ?? null;
    this.details = options.details ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.nextAction ? {nextAction: this.nextAction} : {}),
      ...(this.details ? {details: this.details} : {})
    };
  }
}

export const fail = {
  invalid(message, details) {
    return new AppError('INVALID_INPUT', message, {status: 400, details});
  },
  notFound(message = '记录不存在') {
    return new AppError('NOT_FOUND', message, {status: 404});
  },
  conflict(message, details) {
    return new AppError('VERSION_CONFLICT', message, {status: 409, details});
  },
  stateConflict(message, details) {
    return new AppError('CONFLICT', message, {status: 409, details});
  },
  unsupported(message) {
    return new AppError('NOT_SUPPORTED', message, {status: 405});
  },
  blocked(message, nextAction) {
    return new AppError('BLOCKED', message, {status: 409, nextAction});
  },
  unauthorized(message = '未认证') {
    return new AppError('UNAUTHORIZED', message, {status: 401});
  },
  forbidden(message = '没有权限') {
    return new AppError('FORBIDDEN', message, {status: 403});
  },
  internal(message = '服务内部错误') {
    return new AppError('INTERNAL', message, {status: 500});
  }
};

export function isAppError(value) {
  return value instanceof AppError;
}

/** HTTP 响应体：{error:{code,message,retryable,nextAction},requestId} */
export function toErrorBody(error, requestId) {
  const appError = isAppError(error)
    ? error
    : new AppError('INTERNAL', '服务内部错误', {status: 500});
  return {error: appError.toJSON(), requestId};
}
