// @ts-check

/** @typedef {(error?: unknown) => void} AsyncNext */

/**
 * @template TReq
 * @template TRes
 * @param {(req: TReq, res: TRes, next: AsyncNext) => unknown | Promise<unknown>} handler
 */
export function asyncRoute(handler) {
  /**
   * @param {TReq} req
   * @param {TRes} res
   * @param {AsyncNext} next
   */
  return function asyncRouteHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
